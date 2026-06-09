// Heavy-aggregator feeds for the v2 Console: iMessage activity + token-detail
// view combining Hermes analytics with the ai_invocations Postgres source.
//
// Each collector is fail-soft: if the upstream isn't reachable, return an
// empty payload with a `note` field describing why. None of these should
// ever throw — heavy.json must keep rendering.

import { LOKI_URL } from "../config.ts";
import { getAiInvocationsPool } from "./pg-pool.ts";
import type { HermesAnalytics } from "./hermes-api.ts";
import type { PaperclipHeartbeat, PaperclipAgent } from "./paperclip-api.ts";

function namedOrFallback(value: string | null | undefined, fallback: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || /^\(?unknown\)?$/i.test(trimmed) || /^\(?none\)?$/i.test(trimmed)) return fallback;
  return trimmed;
}

// ---------- iMessage ----------

export type ImessageDirection = "in" | "out";
export type ImessageStatus =
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "received"
  | "unknown";

export interface ImessageEvent {
  id: string;
  direction: ImessageDirection;
  from: string;
  to: string;
  text: string;
  at: string;
  status: ImessageStatus;
}

export interface ImessageFeed {
  recent: ImessageEvent[];
  last24h: { in: number; out: number; failed: number };
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  note?: string;
}

function normalizeImessageStatus(s: string | null | undefined): ImessageStatus {
  const v = (s ?? "").toLowerCase();
  if (v === "sent" || v === "queued") return "sent";
  if (v === "delivered") return "delivered";
  if (v === "read") return "read";
  if (v === "failed" || v === "error") return "failed";
  if (v === "received") return "received";
  return "unknown";
}

interface LokiInboundHit {
  at: string;
  from: string;
  text: string;
}

async function fetchImessageInboundFromLoki(): Promise<LokiInboundHit[]> {
  if (!LOKI_URL) return [];
  const endMs = Date.now();
  const startMs = endMs - 24 * 60 * 60 * 1000;
  const end = (BigInt(endMs) * 1_000_000n).toString();
  const start = (BigInt(startMs) * 1_000_000n).toString();
  const query = `{job=~".+"} |~ "(?i)(sendblue.*inbound|inbound.*sendblue|imessage.*inbound|inbound.*imessage|incoming.*sms)"`;
  const params = new URLSearchParams({
    query,
    limit: "30",
    direction: "backward",
    start,
    end,
  });
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4_000);
    try {
      const res = await fetch(`${LOKI_URL}/loki/api/v1/query_range?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        data?: { result?: Array<{ values?: Array<[string, string]> }> };
      };
      const streams = data.data?.result ?? [];
      const hits: LokiInboundHit[] = [];
      for (const s of streams) {
        for (const [tsNs, line] of s.values ?? []) {
          const tsMs = Number(BigInt(tsNs) / 1_000_000n);
          let from = "";
          let text = line;
          // Try to parse JSON log lines that contain from/text fields.
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const f = (parsed.from ?? parsed.sender ?? parsed.number) as string | undefined;
            const t = (parsed.text ?? parsed.body ?? parsed.message) as string | undefined;
            if (f) from = String(f);
            if (t) text = String(t);
          } catch {
            // plain text line — best effort regex for a phone number
            const m = line.match(/\+?\d{10,15}/);
            if (m) from = m[0];
          }
          hits.push({
            at: new Date(tsMs).toISOString(),
            from: namedOrFallback(from, "Sender not reported"),
            text: text.length > 240 ? text.slice(0, 240) + "…" : text,
          });
        }
      }
      hits.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      return hits.slice(0, 15);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

export async function collectImessageFeed(): Promise<ImessageFeed> {
  const pool = getAiInvocationsPool();
  if (!pool) {
    return {
      recent: [],
      last24h: { in: 0, out: 0, failed: 0 },
      lastInboundAt: null,
      lastOutboundAt: null,
      note: "Message history is unavailable — configure the message database connection",
    };
  }
  try {
    // We only have outbound rows (sent + failed) in this DB today. Inbound
    // SendBlue webhooks aren't persisted to Postgres yet — leave the `in`
    // counters at 0 and document that fact in the note. When inbound
    // logging lands, drop a UNION ALL against the inbound table here.
    const [sendsRes, failsRes, totalsRes] = await Promise.all([
      pool.query(`
        SELECT id::text AS id, sent_at, recipient, text, sendblue_status, source_event
        FROM imessage_sends
        ORDER BY sent_at DESC
        LIMIT 15
      `),
      pool.query(`
        SELECT id::text AS id, failed_at AS sent_at, payload, error_class
        FROM imessage_send_failures
        ORDER BY failed_at DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT
          (SELECT count(*)::int FROM imessage_sends WHERE sent_at >= now() - interval '24 hours') AS out_count,
          (SELECT count(*)::int FROM imessage_send_failures WHERE failed_at >= now() - interval '24 hours') AS failed_count,
          (SELECT max(sent_at) FROM imessage_sends) AS last_out
      `),
    ]);

    const inboundHits = await fetchImessageInboundFromLoki();
    const inboundEvents: ImessageEvent[] = inboundHits.map((h, idx) => ({
      id: `i${idx}-${Date.parse(h.at)}`,
      direction: "in" as ImessageDirection,
      from: h.from,
      to: "agent-platform",
      text: h.text,
      at: h.at,
      status: "received" as ImessageStatus,
    }));

    const recent: ImessageEvent[] = [
      ...inboundEvents,
      ...sendsRes.rows.map((row: Record<string, unknown>) => {
        const sentAt = row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at);
        return {
          id: `s${row.id}`,
          direction: "out" as ImessageDirection,
          from: "agent-platform",
          to: (row.recipient as string) ?? "",
          text: (row.text as string) ?? "",
          at: sentAt,
          status: normalizeImessageStatus(row.sendblue_status as string | null),
        };
      }),
      ...failsRes.rows.map((row: Record<string, unknown>) => {
        const sentAt = row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at);
        const payload = (row.payload as Record<string, unknown> | null) ?? {};
        return {
          id: `f${row.id}`,
          direction: "out" as ImessageDirection,
          from: "agent-platform",
          to: (payload.recipient as string) ?? "",
          text: (payload.text as string) ?? `Message send failed · ${namedOrFallback(row.error_class as string | null, "reason not reported")}`,
          at: sentAt,
          status: "failed" as ImessageStatus,
        };
      }),
    ]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 20);

    const totals = totalsRes.rows[0] as Record<string, unknown> | undefined;
    const lastOut = totals?.last_out;
    const lastInboundAt = inboundEvents.length > 0 ? inboundEvents[0].at : null;
    return {
      recent,
      last24h: {
        in: inboundEvents.length,
        out: Number(totals?.out_count ?? 0),
        failed: Number(totals?.failed_count ?? 0),
      },
      lastInboundAt,
      lastOutboundAt: lastOut instanceof Date ? lastOut.toISOString() : (lastOut as string | null) ?? null,
      note: inboundEvents.length === 0 ? "Inbound message capture is not configured yet" : undefined,
    };
  } catch (e) {
    return {
      recent: [],
      last24h: { in: 0, out: 0, failed: 0 },
      lastInboundAt: null,
      lastOutboundAt: null,
      note: `Message history query failed: ${(e as Error).message}`,
    };
  }
}

// ---------- Tokens ----------

export interface TokenBucket {
  input: number;
  output: number;
  cache_read: number;
  reasoning: number;
  total: number;
}

export interface TokenDailyEntry extends TokenBucket {
  day: string;
}

export interface TokensFeed {
  mtd: TokenBucket;
  today: TokenBucket;
  daily: TokenDailyEntry[];
  bySource: Array<{ source: string; tokens: number; calls: number }>;
  byModel: Array<{ model: string; tokens: number; calls: number }>;
  byAgent: Array<{ agent: string; tokens: number; calls: number }>;
  cacheReadRatio: number;
  note?: string;
}

function zeroBucket(): TokenBucket {
  return { input: 0, output: 0, cache_read: 0, reasoning: 0, total: 0 };
}

function bucketTotal(b: Omit<TokenBucket, "total">): number {
  return b.input + b.output + b.cache_read + b.reasoning;
}

export interface TokensFeedInputs {
  agents?: PaperclipAgent[];
  heartbeats?: PaperclipHeartbeat[];
}

export async function collectTokensFeed(
  hermesAnalytics: HermesAnalytics | null,
  inputs: TokensFeedInputs = {},
): Promise<TokensFeed> {
  // The deepest source for cache_read + reasoning tokens is the Hermes
  // analytics endpoint (already fetched by heavy.ts) — those columns
  // aren't present in the ai_invocations Postgres schema today. We layer
  // ai_invocations on top for source/agent breakdowns + today's slice
  // that includes non-Hermes producers (codex-proxy, with-codex-worker).
  const daily: TokenDailyEntry[] = (hermesAnalytics?.daily ?? []).map((d) => {
    const b: TokenBucket = {
      input: d.input_tokens ?? 0,
      output: d.output_tokens ?? 0,
      cache_read: d.cache_read_tokens ?? 0,
      reasoning: d.reasoning_tokens ?? 0,
      total: 0,
    };
    b.total = bucketTotal(b);
    return { day: d.day, ...b };
  });

  const totals = hermesAnalytics?.totals;
  const mtd: TokenBucket = {
    input: totals?.total_input ?? 0,
    output: totals?.total_output ?? 0,
    cache_read: totals?.total_cache_read ?? 0,
    reasoning: totals?.total_reasoning ?? 0,
    total: 0,
  };
  mtd.total = bucketTotal(mtd);

  const today = daily[daily.length - 1] ?? { day: "", ...zeroBucket() };
  const { day: _today_day, ...todayBucket } = today;
  void _today_day;

  const byModel = (hermesAnalytics?.by_model ?? []).map((m) => ({
    model: m.model,
    tokens: (m.input_tokens ?? 0) + (m.output_tokens ?? 0),
    calls: m.api_calls ?? 0,
  }));

  // bySource + byAgent from the ai_invocations table. Many rows have NULL
  // token counts (claude-code hook records only cost_usd today); we still
  // surface them so the source list shows real call volume.
  let bySource: TokensFeed["bySource"] = [];
  let byAgent: TokensFeed["byAgent"] = [];
  let note: string | undefined;
  const pool = getAiInvocationsPool();
  if (pool) {
    try {
      const [sourceRes, agentRes] = await Promise.all([
        pool.query(`
          SELECT source,
                 coalesce(sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)), 0)::bigint AS tokens,
                 count(*)::int AS calls
          FROM ai_invocations
          WHERE ts >= date_trunc('month', now())
          GROUP BY source
          ORDER BY tokens DESC, calls DESC
        `),
        pool.query(`
          SELECT coalesce(nullif(trim(metadata->>'agent'), ''),
                          nullif(trim(metadata->>'identity'), ''),
                          nullif(trim(identity), '')) AS agent,
                 coalesce(sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)), 0)::bigint AS tokens,
                 count(*)::int AS calls
          FROM ai_invocations
          WHERE ts >= date_trunc('month', now())
          GROUP BY agent
          ORDER BY calls DESC
          LIMIT 40
        `),
      ]);
      bySource = sourceRes.rows.map((r: Record<string, unknown>) => ({
        source: (r.source as string) ?? "(none)",
        tokens: Number(r.tokens ?? 0),
        calls: Number(r.calls ?? 0),
      }));

      // Build a UUID -> friendly-name map from Paperclip roster + heartbeats
      // so we can resolve raw agent_ids that ai_invocations emitted.
      const nameById = new Map<string, string>();
      for (const a of inputs.agents ?? []) {
        if (a.id && a.name) nameById.set(a.id, a.name);
      }
      for (const hb of inputs.heartbeats ?? []) {
        if (hb.id && hb.agentName && !nameById.has(hb.id)) nameById.set(hb.id, hb.agentName);
      }

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const resolved: TokensFeed["byAgent"] = [];
      let untaggedTokens = 0;
      let untaggedCalls = 0;
      // Pool of unresolved UUID agents — these are external/one-off identities
      // (test runs, ad-hoc smoke scripts, codex-pool worker UUIDs that never
      // landed in the Paperclip roster). Surfacing them as `agent 4ee5d9dc`
      // is noise; bucket them all into a single "external · N agents" row
      // placed last so the byAgent list stays scannable.
      let externalTokens = 0;
      let externalCalls = 0;
      const externalIds = new Set<string>();
      for (const r of agentRes.rows as Record<string, unknown>[]) {
        const raw = (r.agent as string | null) ?? null;
        const tokens = Number(r.tokens ?? 0);
        const calls = Number(r.calls ?? 0);
        if (!raw) {
          untaggedTokens += tokens;
          untaggedCalls += calls;
          continue;
        }
        if (UUID_RE.test(raw)) {
          const friendly = nameById.get(raw);
          if (friendly) {
            resolved.push({ agent: friendly, tokens, calls });
          } else {
            externalTokens += tokens;
            externalCalls += calls;
            externalIds.add(raw);
          }
          continue;
        }
        resolved.push({ agent: raw, tokens, calls });
      }

      // Coalesce duplicate labels that resolved to the same friendly name.
      const coalesced = new Map<string, { agent: string; tokens: number; calls: number }>();
      for (const r of resolved) {
        const cur = coalesced.get(r.agent);
        if (cur) {
          cur.tokens += r.tokens;
          cur.calls += r.calls;
        } else {
          coalesced.set(r.agent, { ...r });
        }
      }
      byAgent = Array.from(coalesced.values()).sort((a, b) => b.calls - a.calls).slice(0, 20);

      if (externalCalls > 0) {
        byAgent.push({
          agent: `external · ${externalIds.size} agent${externalIds.size === 1 ? "" : "s"}`,
          tokens: externalTokens,
          calls: externalCalls,
        });
      }
      if (untaggedCalls > 0) {
        byAgent.push({
          agent: `untagged · ${untaggedCalls.toLocaleString("en-US")} rows`,
          tokens: untaggedTokens,
          calls: untaggedCalls,
        });
      }
    } catch (e) {
      note = `ai_invocations breakdown failed: ${(e as Error).message}`;
    }
  } else {
    note = "AI_INVOCATIONS_DB_URL not configured — bySource/byAgent empty";
  }

  // cacheReadRatio: how much of the model's prompt context is being served
  // by the prompt cache vs fresh input tokens. Higher = cheaper.
  const denom = mtd.input + mtd.cache_read;
  const cacheReadRatio = denom > 0 ? mtd.cache_read / denom : 0;

  return {
    mtd,
    today: { ...todayBucket, total: bucketTotal(todayBucket) },
    daily,
    bySource,
    byModel,
    byAgent,
    cacheReadRatio,
    note,
  };
}
