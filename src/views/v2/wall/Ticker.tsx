// Ticker — vertical scrolling event list pinned to the right rail of /wall.
//
// Sources:
//   - alert.created / alert.resolved   → red dot, severity-driven    [keep]
//   - approval.created / approval.decided → coral dot                 [keep — high signal]
//   - codex-worker.quarantine          → coral dot                    [keep]
//   - heartbeat                        → teal dot, SUPPRESSED unless
//                                        gap > 2× interval (~> 2min)
//   - tokens.5m (synthesised here)     → teal dot, "X.Yk input / Z.Wk output"
//     · we poll /api/ops/heavy.json every 30s and diff heavy.tokens.today
//       (server already refreshes that table every 20s) so each visible
//       token tick represents a true delta — never a static snapshot.
//     · ALSO emits a synthetic token-burst event when the 30s rate exceeds
//       2× the rolling 5min average.
//
// Noise filter:
//   - Consecutive duplicate rows (same `what` text) collapse into a single
//     row with "×N · last <relative>". Updated counts/timestamps in place.
//   - heartbeat individual events are suppressed entirely; we surface them
//     only when a heartbeat is overdue (gap > 2× the 60s sample interval).
//
// Cost-related events are intentionally NOT shown on the wall ticker — the
// platform pivoted to tokens for capacity. /spend retains $$$.
//
// We subscribe to /api/stream for the live SSE-backed events; tokens are
// derived from the periodic heavy poll (cheap because TanStack Query
// already dedupes the request with the rest of the wall).

import { useEffect, useRef, useState } from "react";

import { useAlerts, useHeavy, type AlertItem } from "../data/queries.ts";
import { displaySourceLabel, displayStatusLabel } from "../data/display.ts";
import { resolveEventDisplayName } from "../../../lib/event-display-names.ts";

const MAX_EVENTS = 24;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const STALE_EVENT_SWEEP_MS = 60_000;
const HEARTBEAT_SAMPLE_MS = 60_000;
const HEARTBEAT_LATE_MS = 2 * HEARTBEAT_SAMPLE_MS; // > 2x interval = late
const TOKEN_BURST_WINDOW_S = 30;
const TOKEN_BURST_AVG_WINDOW_S = 300;
const TOKEN_BURST_MULTIPLIER = 2;

type TickKind =
  | "alert"
  | "heartbeat"
  | "tokens"
  | "approval"
  | "codex"
  | "burst";

export interface TickEvent {
  id: string;
  ts: number;
  kind: TickKind;
  who: string;
  what: string;
  tag: string;
  dot: "ok" | "warn" | "bad";
  /** group key used to collapse consecutive duplicates */
  groupKey: string;
  /** number of collapsed events; 1 means no collapse */
  count: number;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function fmtTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtRelative(deltaMs: number): string {
  const s = Math.max(1, Math.round(deltaMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function alertToEvent(a: AlertItem): TickEvent {
  return {
    id: `alert:${a.id}`,
    ts: a.sinceMs ?? Date.now(),
    kind: "alert",
    who: resolveEventDisplayName(a.kind, { source: "alert" }),
    what: a.title,
    tag: a.severity,
    dot: a.severity === "critical" ? "bad" : a.severity === "warn" ? "warn" : "ok",
    groupKey: `alert:${a.id}`, // alerts dedupe by id, not by title
    count: 1,
  };
}

function isFresh(ev: TickEvent, now = Date.now()): boolean {
  return now - ev.ts <= MAX_EVENT_AGE_MS;
}

export function pruneStaleEvents(events: TickEvent[], now = Date.now()): TickEvent[] {
  return events.filter((e) => isFresh(e, now));
}

interface HeartbeatPayload {
  agentId: string;
  agentName: string;
  status: string;
  lastHeartbeatAt: string;
}

interface ApprovalPayload {
  id: string;
  title?: string;
  source?: string;
  kind?: string;
  status?: string;
}

interface CodexWorkerEventPayload {
  id?: string;
  workerId?: string;
  action?: string;
  reason?: string;
}

export function Ticker({ onAlert }: { onAlert?: (a: AlertItem) => void }) {
  const alerts = useAlerts();
  const heavy = useHeavy();
  const [events, setEvents] = useState<TickEvent[]>([]);
  const [evPerMin, setEvPerMin] = useState(0);

  // Refs used by the heavy-diff effect — we need the previous totals across
  // renders without re-subscribing.
  const lastTokensRef = useRef<{ input: number; output: number; total: number } | null>(null);
  const recentTsRef = useRef<number[]>([]);
  // Token rate samples: timestamps + per-sample delta. Used to detect bursts.
  const tokenSamplesRef = useRef<Array<{ ts: number; delta: number }>>([]);
  const lastBurstTsRef = useRef<number>(0);

  // Seed the ticker with whatever the alerts API already knows about.
  // De-dupe by groupKey on the way in so the rail starts in the same
  // collapsed shape live events would settle into.
  useEffect(() => {
    if (!alerts.data) return;
    const seeded: TickEvent[] = [];
    const byKey = new Map<string, number>();
    for (const a of alerts.data.alerts) {
      const ev = alertToEvent(a);
      if (!isFresh(ev)) continue;
      const existing = byKey.get(ev.groupKey);
      if (existing != null) {
        seeded[existing].count += 1;
        continue;
      }
      byKey.set(ev.groupKey, seeded.length);
      seeded.push(ev);
      if (seeded.length >= MAX_EVENTS) break;
    }
    setEvents((prev) => {
      // Only seed if the ticker is empty — otherwise live events should win.
      const freshPrev = pruneStaleEvents(prev);
      if (freshPrev.length > 0) return freshPrev;
      return seeded;
    });
  }, [alerts.data]);

  // A quiet ticker should still age out old rows. Previously stale alerts only
  // fell off when another event called push(), so a backup-stale row could sit
  // in an idle browser session indefinitely.
  useEffect(() => {
    const prune = () => {
      setEvents((prev) => {
        const next = pruneStaleEvents(prev);
        return next.length === prev.length ? prev : next;
      });
    };
    prune();
    const interval = window.setInterval(prune, STALE_EVENT_SWEEP_MS);
    return () => window.clearInterval(interval);
  }, []);

  function push(ev: TickEvent) {
    if (!isFresh(ev)) return;
    const now = Date.now();
    recentTsRef.current.push(now);
    while (recentTsRef.current.length > 0 && now - recentTsRef.current[0] > 60_000) {
      recentTsRef.current.shift();
    }
    setEvPerMin(recentTsRef.current.length);
    setEvents((prev) => {
      const freshPrev = pruneStaleEvents(prev, now);
      // Collapse by groupKey across the entire visible window — anything
      // sharing a groupKey merges into a single row regardless of position.
      const existingIdx = freshPrev.findIndex((p) => p.groupKey === ev.groupKey);
      if (existingIdx >= 0) {
        const head = freshPrev[existingIdx];
        const merged: TickEvent = {
          ...head,
          ts: ev.ts,
          count: head.count + 1,
          // Keep the existing id so React doesn't remount the row, but
          // refresh the displayed text/dot/tag in case the latest event
          // carried new detail (e.g. status flip).
          what: ev.what,
          dot: ev.dot,
          tag: ev.tag,
        };
        // Move the merged row to the top so the freshest grouped activity
        // is always visible at the head of the rail.
        const rest = freshPrev.slice(0, existingIdx).concat(freshPrev.slice(existingIdx + 1));
        return [merged, ...rest];
      }
      return [ev, ...freshPrev].slice(0, MAX_EVENTS);
    });
  }

  // Heavy poll → derive token tick events from deltas.
  useEffect(() => {
    const today = heavy.data?.tokens.today;
    if (!today) return;
    const prev = lastTokensRef.current;
    lastTokensRef.current = { input: today.input, output: today.output, total: today.total };
    if (prev && (today.input > prev.input || today.output > prev.output)) {
      const dIn = today.input - prev.input;
      const dOut = today.output - prev.output;
      // Only emit tick if delta is meaningful (>0 either side).
      if (dIn + dOut > 0) {
        const now = Date.now();
        const delta = dIn + dOut;

        // Burst detection: maintain a rolling window of (ts, delta) samples,
        // compute the per-second rate for the last 30s vs the last 5min, and
        // emit a synthetic token-burst event when the short window is
        // ≥ 2× the long window's average. Cool down 60s between bursts so
        // a sustained spike doesn't flood the rail.
        tokenSamplesRef.current.push({ ts: now, delta });
        const cutoff = now - TOKEN_BURST_AVG_WINDOW_S * 1000;
        tokenSamplesRef.current = tokenSamplesRef.current.filter(
          (s) => s.ts >= cutoff,
        );
        const shortStart = now - TOKEN_BURST_WINDOW_S * 1000;
        let short = 0;
        let long = 0;
        for (const s of tokenSamplesRef.current) {
          long += s.delta;
          if (s.ts >= shortStart) short += s.delta;
        }
        const longAvgPerSec = long / TOKEN_BURST_AVG_WINDOW_S;
        const shortAvgPerSec = short / TOKEN_BURST_WINDOW_S;
        const burstReady =
          tokenSamplesRef.current.length >= 3 &&
          longAvgPerSec > 0 &&
          shortAvgPerSec >= longAvgPerSec * TOKEN_BURST_MULTIPLIER &&
          now - lastBurstTsRef.current > 60_000;
        if (burstReady) {
          lastBurstTsRef.current = now;
          const ratio = shortAvgPerSec / longAvgPerSec;
          push({
            id: `burst:${now}`,
            ts: now,
            kind: "burst",
            who: resolveEventDisplayName("burst", { source: "burst" }),
            what: `Token burst · ${ratio.toFixed(1)}× rolling average`,
            tag: "token burst",
            dot: "warn",
            groupKey: "burst:tokens",
            count: 1,
          });
        }

        push({
          id: `tok:${now}`,
          ts: now,
          kind: "tokens",
          who: resolveEventDisplayName("tokens", { source: "tokens" }),
          what: `${fmtTokensCompact(dIn)} input / ${fmtTokensCompact(dOut)} output`,
          tag: "tokens · 5 min",
          dot: "ok",
          groupKey: "tokens:tick",
          count: 1,
        });
      }
    }
  }, [heavy.data]);

  // SSE subscription for alerts + approvals + codex events + heartbeat
  // staleness detection.
  useEffect(() => {
    const es = new EventSource("/api/stream", { withCredentials: true });
    const lastHeartbeatBy = new Map<string, number>();

    es.addEventListener("alert.created", (evt) => {
      const msg = evt as MessageEvent<string>;
      try {
        const a = JSON.parse(msg.data) as AlertItem;
        push(alertToEvent(a));
        onAlert?.(a);
      } catch {
        /* ignore malformed */
      }
    });

    es.addEventListener("alert.resolved", (evt) => {
      const msg = evt as MessageEvent<string>;
      try {
        const a = JSON.parse(msg.data) as { id: string; title?: string };
        setEvents((prev) => prev.filter((e) => e.id !== `alert:${a.id}`));
        push({
          id: `alert-r:${a.id}:${Date.now()}`,
          ts: Date.now(),
          kind: "alert",
          who: resolveEventDisplayName("alert.resolved", { source: "alert" }),
          what: `Alert cleared · ${a.title ?? "details not reported"}`,
          tag: "resolved",
          dot: "ok",
          groupKey: `alert-r:${a.id}`,
          count: 1,
        });
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("approval.created", (evt) => {
      const msg = evt as MessageEvent<string>;
      try {
        const a = JSON.parse(msg.data) as ApprovalPayload;
        const displayName = resolveEventDisplayName(a.kind ?? a.source, { source: "approval" });
        push({
          id: `apv-c:${a.id}`,
          ts: Date.now(),
          kind: "approval",
          who: displayName,
          what: `Approval requested · ${a.title ?? "details not reported"}`,
          tag: "pending",
          dot: "warn",
          groupKey: `apv-c:${a.id}`,
          count: 1,
        });
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("approval.decided", (evt) => {
      const msg = evt as MessageEvent<string>;
      try {
        const a = JSON.parse(msg.data) as ApprovalPayload;
        const displayName = resolveEventDisplayName(a.kind ?? a.source, { source: "approval" });
        push({
          id: `apv-d:${a.id}`,
          ts: Date.now(),
          kind: "approval",
          who: displayName,
          what: `Approval ${displayStatusLabel(a.status ?? "decided").toLowerCase()} · ${a.title ?? "details not reported"}`,
          tag: displayStatusLabel(a.status ?? "decided"),
          dot: a.status === "approved" ? "ok" : a.status === "denied" ? "bad" : "warn",
          groupKey: `apv-d:${a.id}`,
          count: 1,
        });
      } catch {
        /* ignore */
      }
    });

    // codex-worker.quarantine events from the codex pool runtime.
    es.addEventListener("codex-worker.quarantine", (evt) => {
      const msg = evt as MessageEvent<string>;
      try {
        const p = JSON.parse(msg.data) as CodexWorkerEventPayload;
        const id = p.id ?? p.workerId ?? "worker not reported";
        const action = p.action ?? "quarantine";
        push({
          id: `codex:${id}:${Date.now()}`,
          ts: Date.now(),
          kind: "codex",
          who: id,
          what: `Codex worker ${displayStatusLabel(action).toLowerCase()}${p.reason ? ` · ${p.reason}` : ""}`,
          tag: "Codex pool",
          dot: action === "unquarantine" ? "ok" : "bad",
          groupKey: `codex:${id}:${action}`,
          count: 1,
        });
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("heartbeat", (evt) => {
      // Heartbeat events are SUPPRESSED individually. We only surface them
      // when a previously-seen agent goes overdue (gap > 2× the 60s sample
      // interval) — a "missed heartbeat" condition worth seeing on the wall.
      const msg = evt as MessageEvent<string>;
      try {
        const h = JSON.parse(msg.data) as HeartbeatPayload;
        const last = lastHeartbeatBy.get(h.agentId) ?? 0;
        const now = Date.now();
        if (last > 0 && now - last > HEARTBEAT_LATE_MS) {
          push({
            id: `hb-late:${h.agentId}:${now}`,
            ts: now,
            kind: "heartbeat",
            who: h.agentName,
            what: `Heartbeat overdue · ${Math.round((now - last) / 1000)}s gap`,
            tag: "heartbeat · late",
            dot: "warn",
            groupKey: `hb-late:${h.agentId}`,
            count: 1,
          });
        }
        lastHeartbeatBy.set(h.agentId, now);
      } catch {
        /* ignore */
      }
    });

    return () => {
      try { es.close(); } catch { /* ignore */ }
    };
  }, [onAlert]);

  return (
    <aside className="wall-tick" aria-label="Event ticker">
      <div className="wall-tick-h">
        <h2>Event ticker <small>live stream</small></h2>
        <span className="ratemono">{evPerMin} ev/min</span>
      </div>
      <div className="wall-tick-list">
        {events.length === 0 && (
          <div style={{ padding: "20px 0", color: "var(--fg-3)", fontFamily: "var(--mono)", fontSize: 11 }}>
            Listening…
          </div>
        )}
        {events.map((e) => {
          // Show the ×N · last <rel> grouping suffix once a row has collapsed
          // 3+ siblings. Below the threshold we keep the bare label so a
          // single event doesn't get visual noise.
          const grouped = e.count >= 3;
          return (
            <div className="wall-tick-ev" key={e.id}>
              <span className="ts">{fmtTime(e.ts)}</span>
              <span className={`dot ${e.dot === "bad" ? "bad" : e.dot === "warn" ? "warn" : ""}`} />
              <div className="body">
                <span className="who">{displaySourceLabel(e.who)}</span>
                <span className="what">
                  {e.what}
                  {grouped && (
                    <>
                      {" "}
                      <span style={{ color: "var(--fg-3)" }}>
                        ×{e.count} · last {fmtRelative(Date.now() - e.ts)}
                      </span>
                    </>
                  )}
                </span>
                <div className="tag">{displaySourceLabel(e.tag)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
