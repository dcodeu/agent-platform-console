// OverviewTab — in-depth single-screen system health.
//
// Pulse row · Token flow · Top breakdowns · Unified timeline ·
// System health · Container restarts. Native widgets — no iframes.

import { useMemo, useState } from "react";

import { useHeavy, useSnapshot } from "../data/queries.ts";
import { useRangeContext } from "../data/RangeContext.tsx";
import { usePromInstant, usePgQuery } from "../widgets/useNativeData.ts";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { NativeStat } from "../widgets/NativeStat.tsx";
import { Sparkline } from "../widgets/Sparkline.tsx";
import { LineChart } from "../widgets/LineChart.tsx";
import { BarList } from "../widgets/BarList.tsx";
import { Heatmap, type HeatmapCell } from "../widgets/Heatmap.tsx";
import { StatusPill, type PillState } from "../widgets/StatusPill.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";
import { CodexWorkerDrawer } from "../CodexWorkerDrawer.tsx";
import type { CodexWorker } from "../../../lib/workers.ts";
import {
  formatCount,
  formatRelativeTime,
  formatTokens,
  formatPercent,
} from "../data/format.ts";
import {
  displayMetricLabel,
  displaySourceLabel,
  displayStatusLabel,
  displayWorkerState,
} from "../data/display.ts";
import "./OverviewTab.css";

// Mirrors Grafana panel 20 (ai-invocations-v2.json). The current
// ai_invocations schema has no `total_tokens` column — derive it from
// input + output until that column lands.
const TOKEN_FLOW_BY_SOURCE_SQL = `
  SELECT date_trunc('hour', ts) AS time,
         source AS metric,
         COALESCE(sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS value
  FROM ai_invocations
  WHERE ts > now() - interval '24 hours'
  GROUP BY 1, 2
  ORDER BY 1
`.trim();

const INVOCATIONS_HEATMAP_SQL = `
  SELECT EXTRACT(hour FROM ts)::int AS hour,
         EXTRACT(dow FROM ts)::int  AS dow,
         count(*)::int               AS calls
  FROM ai_invocations
  WHERE ts > now() - interval '14 days'
  GROUP BY 1, 2
`.trim();

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type TimelineSource = "agent" | "imessage" | "alert";

interface TimelineItem {
  id: string;
  source: TimelineSource;
  title: string;
  sub: string;
  at: string | number;
  state: PillState;
}

function poolReadyCount(pool: Array<{ authState?: string; enabled?: boolean }>): number {
  return pool.filter((w) => w.authState === "valid" && w.enabled).length;
}

export function OverviewTab() {
  const snapshot = useSnapshot();
  const heavy = useHeavy();
  const loading = heavy.isPending || snapshot.isPending;
  const data = heavy.data;
  const { def: rangeDef } = useRangeContext();
  const rangeShort = rangeDef.label.replace(/^Last /, "");

  // ── Pulse data ─────────────────────────────────────────────────────
  const mtdTotal = data?.tokens.mtd.total ?? 0;
  const mtdCacheRead = data?.tokens.mtd.cache_read ?? 0;
  const apiCalls = data?.hermes.analytics?.totals.total_api_calls ?? 0;
  const daily = data?.hermes.analytics?.daily ?? [];
  const todayCalls = daily.at(-1)?.api_calls ?? 0;
  const prevCalls = daily.at(-2)?.api_calls ?? 0;
  const callDelta = todayCalls - prevCalls;
  const ime = data?.imessage;
  const imeIn = ime?.last24h.in ?? 0;
  const imeOut = ime?.last24h.out ?? 0;
  const pool = snapshot.data?.agents.codexPool ?? [];
  const readyCount = pool.length ? poolReadyCount(pool) : 0;

  // ── Daily token sparkline ──────────────────────────────────────────
  const dailyTokens = (data?.tokens.daily ?? []).map((d) => d.total);

  // ── Token flow chart points ────────────────────────────────────────
  // Server provides daily buckets across the last 30 days; clip to the
  // active range so the chart caption and data agree.
  const tokenChartSeries = useMemo(() => {
    const days = data?.tokens.daily ?? [];
    const input: Array<[number, number]> = [];
    const output: Array<[number, number]> = [];
    const cache: Array<[number, number]> = [];
    const cutoffMs = Date.now() - rangeDef.durationSec * 1000;
    for (const d of days) {
      const t = Date.parse(d.day + "T00:00:00Z");
      if (!Number.isFinite(t)) continue;
      if (rangeDef.key !== "mtd" && t < cutoffMs) continue;
      input.push([t, d.input]);
      output.push([t, d.output]);
      cache.push([t, d.cache_read]);
    }
    return [
      { name: "input", color: "var(--accent)", points: input },
      { name: "output", color: "var(--attn)", points: output },
      { name: "cache", color: "var(--viz-dim)", points: cache, dashed: true },
    ];
  }, [data?.tokens.daily, rangeDef]);

  // ── Unified timeline (agents, imessage, alerts) ──────────────
  const timeline: TimelineItem[] = useMemo(() => {
    if (!data) return [];
    const items: TimelineItem[] = [];
    for (const a of data.activityFeed.slice(0, 3)) {
      items.push({
        id: `act-${a.id}`,
        source: "agent",
        title: displaySourceLabel(a.agentName || a.role),
        sub: displayStatusLabel(a.status),
        at: a.lastHeartbeatAt ?? Date.now(),
        state: a.stuck ? "alert" : "ok",
      });
    }
    for (const m of data.imessage.recent.slice(0, 3)) {
      const arrow = m.direction === "in" ? "← " : "→ ";
      const counterparty = m.direction === "in" ? m.from : m.to;
      items.push({
        id: `ime-${m.id}`,
        source: "imessage",
        title: `${arrow}${counterparty}`,
        sub: (m.text ?? "").slice(0, 60),
        at: m.at,
        state: m.status === "failed" ? "alert" : m.direction === "in" ? "info" : "ok",
      });
    }
    for (const al of data.alerts.slice(0, 3)) {
      const sinceAt = al.sinceMs ? Date.now() - al.sinceMs : Date.now();
      items.push({
        id: `al-${al.id}`,
        source: "alert",
        title: al.title,
        sub: al.detail ?? displayMetricLabel(al.kind),
        at: sinceAt,
        state: al.severity === "critical" ? "alert" : al.severity === "warn" ? "warn" : "info",
      });
    }
    items.sort((a, b) => {
      const at = typeof a.at === "number" ? a.at : Date.parse(String(a.at));
      const bt = typeof b.at === "number" ? b.at : Date.parse(String(b.at));
      return (bt || 0) - (at || 0);
    });
    return items.slice(0, 12);
  }, [data]);

  // ── Codex-mirrored "Token flow by source · hourly" ────────────────
  const flowBySource = usePgQuery(TOKEN_FLOW_BY_SOURCE_SQL, { refetchMs: 60_000 });
  const flowSourceSeries = useMemo(() => {
    const d = flowBySource.data;
    if (!d || d.rows.length === 0) return [];
    const ci = d.columns.indexOf("time");
    const mi = d.columns.indexOf("metric");
    const vi = d.columns.indexOf("value");
    if (ci < 0 || mi < 0 || vi < 0) return [];
    const buckets = new Map<string, Array<[number, number]>>();
    for (const r of d.rows) {
      const metric = String(r[mi] ?? "");
      const v = Number(r[vi]);
      const tsRaw = r[ci];
      const ms = typeof tsRaw === "string" ? Date.parse(tsRaw) : Number(tsRaw);
      if (!metric || !Number.isFinite(v) || !Number.isFinite(ms)) continue;
      const arr = buckets.get(metric) ?? [];
      arr.push([ms, v]);
      buckets.set(metric, arr);
    }
    const COLORS = ["var(--accent)", "var(--attn)", "var(--viz-dim)", "var(--fg-2)", "var(--alert)"];
    const out: Array<{ name: string; color: string; points: Array<[number, number]> }> = [];
    let i = 0;
    for (const [name, points] of buckets) {
      points.sort((a, b) => a[0] - b[0]);
      out.push({ name, color: COLORS[i % COLORS.length], points });
      i++;
    }
    out.sort((a, b) => {
      const aMax = a.points.reduce((m, [, y]) => Math.max(m, y), 0);
      const bMax = b.points.reduce((m, [, y]) => Math.max(m, y), 0);
      return bMax - aMax;
    });
    return out;
  }, [flowBySource.data]);

  // ── Heatmap: invocations · hour-of-day × day-of-week, 14 days ─────
  const heatmapQuery = usePgQuery(INVOCATIONS_HEATMAP_SQL, { refetchMs: 120_000 });
  const heatmapCells = useMemo<HeatmapCell[]>(() => {
    const d = heatmapQuery.data;
    if (!d) return [];
    const hi = d.columns.indexOf("hour");
    const di = d.columns.indexOf("dow");
    const ci = d.columns.indexOf("calls");
    if (hi < 0 || di < 0 || ci < 0) return [];
    const out: HeatmapCell[] = [];
    for (const r of d.rows) {
      const hour = Number(r[hi]);
      const dow = Number(r[di]);
      const calls = Number(r[ci]);
      if (!Number.isFinite(hour) || !Number.isFinite(dow) || !Number.isFinite(calls)) continue;
      out.push({ x: Math.round(hour), y: Math.round(dow), value: calls });
    }
    return out;
  }, [heatmapQuery.data]);

  // ── Codex worker drawer state ──────────────────────────────────────
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const selectedWorker: CodexWorker | null = useMemo(() => {
    if (!selectedWorkerId) return null;
    return pool.find((w) => w.id === selectedWorkerId) ?? null;
  }, [pool, selectedWorkerId]);

  // ── System health metrics ──────────────────────────────────────────
  const load = usePromInstant("node_load1", { refetchMs: 30_000 });
  const memQuery = usePromInstant(
    "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)",
    { refetchMs: 30_000 },
  );
  const cacheHit = usePgQuery(
    "SELECT round(sum(blks_hit)::numeric / NULLIF(sum(blks_hit) + sum(blks_read), 0) * 100, 1) AS pct FROM pg_stat_database",
    { refetchMs: 60_000 },
  );

  const kumaUp = (data?.upstream ?? []).filter((u) => u.ok).length;
  const kumaTotal = (data?.upstream ?? []).length;

  const loadAvg = load.data?.[0]?.value ?? null;
  const memPct = memQuery.data?.[0]?.value ?? null;
  const cacheHitPct = cacheHit.data?.rows[0]?.[0] != null ? Number(cacheHit.data.rows[0][0]) : null;

  // ── Container restarts ─────────────────────────────────────────────
  const restartedContainers = (snapshot.data?.docker ?? []).filter((c) => {
    const s = c.status.toLowerCase();
    return s.includes("restart") || (!s.includes("up") && !s.includes("exited"));
  });

  return (
    <>
      {/* Pulse row */}
      <section className="ov-pulse" aria-label="Pulse">
        <NativeStat
          title="Tokens used this month"
          value={formatTokens(mtdTotal)}
          source="token totals · month to date"
          sub={`cache reads ${formatTokens(mtdCacheRead)}`}
          loading={loading}
        />
        <NativeStat
          title="Agent calls"
          value={formatCount(apiCalls)}
          source="agent activity · last 30 days"
          delta={
            callDelta !== 0
              ? { value: callDelta, positive: callDelta > 0, label: (callDelta >= 0 ? "+" : "") + String(callDelta) }
              : undefined
          }
          sub="compared with yesterday"
          loading={loading}
        />
        <NativeStat
          title="Messages in the last 24 hours"
          value={formatCount(imeIn + imeOut)}
          source="message history · last 24 hours"
          sub={
            ime?.lastInboundAt
              ? `last ${formatRelativeTime(ime.lastInboundAt)}`
              : `↑ ${imeOut} ↓ ${imeIn}`
          }
          loading={loading}
        />
        <WidgetCard title="Codex workers ready" source="live worker snapshot" loading={loading}>
          <div className="ov-pool">
            <div className="ov-pool-n">
              <span className="ov-pool-num">{readyCount}</span>
              <span className="ov-pool-tot">of {pool.length || 11}</span>
            </div>
            <div className="ov-pool-grid" role="list">
              {pool.length
                ? pool.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      role="listitem"
                      data-worker-id={w.id}
                      title={`${w.id} · ${displayWorkerState(w.authState, w.enabled)} · open details`}
                      aria-label={`${w.id} ${displayWorkerState(w.authState, w.enabled)} — open details`}
                      onClick={() => setSelectedWorkerId(w.id)}
                      className={`ov-pool-sq${w.authState === "valid" && w.enabled ? "" : " is-quar"}`}
                    />
                  ))
                : Array.from({ length: 11 }, (_, i) => (
                    <span key={i} className="ov-pool-sq" />
                  ))}
            </div>
          </div>
        </WidgetCard>
      </section>

      {/* Token flow + sparkline */}
      <section className="ov-flow" aria-label="Token flow">
        <WidgetCard title={`Token flow · ${rangeShort}`} source="daily token totals" loading={loading}>
          {tokenChartSeries[0].points.length === 0 ? (
            <EmptyState title="No daily token data yet" />
          ) : (
            <LineChart
              series={tokenChartSeries}
              height={220}
              yFormat={(v) => formatTokens(v)}
              xFormat={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              ariaLabel="Token flow over time"
            />
          )}
        </WidgetCard>
        <WidgetCard
          title="Month-to-date trend"
          source="daily token totals"
          loading={loading}
          footer={
            <>
              <span>peak {formatTokens(Math.max(...dailyTokens, 0))}</span>
              <span>{dailyTokens.length} days</span>
            </>
          }
        >
          <Sparkline points={dailyTokens} height={56} ariaLabel="Daily token totals" />
          <div className="ov-spark-sub">
            today <b>{formatTokens(data?.tokens.today.total ?? 0)}</b>
          </div>
        </WidgetCard>
      </section>

      {/* Token flow by source · hourly */}
      <section className="ov-flow-single" aria-label="Token flow by source · 24h">
        <WidgetCard
          title="Hourly token use by tool"
          source="token totals · last 24 hours"
          loading={flowBySource.isPending}
          error={flowBySource.error ? (flowBySource.error as Error).message : null}
        >
          {flowSourceSeries.length === 0 ? (
            <EmptyState title="No hourly token data yet" />
          ) : (
            <LineChart
              series={flowSourceSeries}
              height={200}
              yFormat={(v) => formatTokens(v)}
              xFormat={(t) =>
                new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", hour12: false })
              }
              ariaLabel="Token flow by source over the last 24 hours"
            />
          )}
        </WidgetCard>
      </section>

      {/* When invocations happen — heatmap */}
      <section className="ov-heatmap-section" aria-label="When invocations happen">
        <WidgetCard
          title="When agent calls happen · last 14 days"
          source="agent activity · last 14 days"
          loading={heatmapQuery.isPending}
          error={heatmapQuery.error ? (heatmapQuery.error as Error).message : null}
          footer={
            <>
              <span>hour of day × day of week</span>
              <span>calls (max highlighted)</span>
            </>
          }
        >
          {heatmapCells.length === 0 ? (
            <EmptyState title="No invocations in the last 14 days" />
          ) : (
            <Heatmap
              cells={heatmapCells}
              xLabels={HOUR_LABELS}
              yLabels={DOW_LABELS}
              valueFormat={(n) => `${formatCount(n)} calls`}
              height={220}
              ariaLabel="Invocations heatmap, hour of day by day of week"
            />
          )}
        </WidgetCard>
      </section>

      {/* Breakdowns */}
      <section className="ov-breakdown" aria-label="Breakdowns">
        <WidgetCard title="Tokens by tool" source="token totals · month to date" loading={loading}>
          <BarList
            items={(data?.tokens.bySource ?? [])
              .slice(0, 8)
              .map((r) => ({
                label: displaySourceLabel(r.source),
                value: r.tokens,
                sub: `${formatCount(r.calls)} calls`,
              }))}
            valueFormat={formatTokens}
            emptyLabel="No source data"
          />
        </WidgetCard>
        <WidgetCard title="Tokens by model" source="token totals · month to date" loading={loading}>
          <BarList
            items={(data?.tokens.byModel ?? [])
              .slice(0, 8)
              .map((r) => ({
                label: r.model || "—",
                value: r.tokens,
                sub: `${formatCount(r.calls)} calls`,
              }))}
            valueFormat={formatTokens}
            color="var(--attn)"
            emptyLabel="No model data"
          />
        </WidgetCard>
      </section>

      {/* Unified timeline */}
      <section className="ov-timeline-section" aria-label="Now happening">
        <WidgetCard title="Now happening" source="combined live feed" loading={loading} flush>
          {timeline.length === 0 ? (
            <EmptyState title="Quiet" body="No agent, automation, iMessage, or alert activity" />
          ) : (
            <ol className="ov-timeline">
              {timeline.map((it) => (
                <li key={it.id} className={`ov-tl-item ov-tl-${it.source}`}>
                  <span className="ov-tl-tag">{displaySourceLabel(it.source)}</span>
                  <span className="ov-tl-body">
                    <span className="ov-tl-title">{it.title}</span>
                    {it.sub ? <span className="ov-tl-sub">{it.sub}</span> : null}
                  </span>
                  <StatusPill state={it.state} label={displayStatusLabel(it.state)} />
                  <span className="ov-tl-ts">{formatRelativeTime(it.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </WidgetCard>
      </section>

      {/* System health */}
      <section className="ov-sys" aria-label="System health">
        <NativeStat
          title="Host load"
          value={loadAvg != null ? loadAvg.toFixed(2) : "—"}
          source="server metrics · live now"
          sub="1-minute load average"
          loading={load.isPending}
        />
        <NativeStat
          title="Memory"
          value={memPct != null ? `${memPct.toFixed(1)}%` : "—"}
          source="server metrics · live now"
          sub="used"
          loading={memQuery.isPending}
        />
        <NativeStat
          title="Kuma · monitors"
          value={`${kumaUp} / ${kumaTotal}`}
          source="monitor checks · live now"
          sub={`${kumaTotal - kumaUp} down`}
          loading={loading}
        />
        <NativeStat
          title="Database reads from memory"
          value={cacheHitPct != null ? `${cacheHitPct.toFixed(1)}%` : "—"}
          source="database metrics · live now"
          sub="cache hit ratio"
          loading={cacheHit.isPending}
        />
      </section>

      {/* Container restarts */}
      {restartedContainers.length > 0 ? (
        <section aria-label="Container restarts">
          <WidgetCard title="Containers needing attention" source="container status">
            <ul className="ov-restarts">
              {restartedContainers.map((c) => (
                <li key={c.name}>
                  <span className="ov-restart-name">{c.name}</span>
                  <StatusPill state="warn" label={displayStatusLabel(c.status.split(" ")[0])} />
                  <span className="ov-restart-img">{c.image}</span>
                </li>
              ))}
            </ul>
          </WidgetCard>
        </section>
      ) : null}

      <CodexWorkerDrawer
        worker={selectedWorker}
        onClose={() => setSelectedWorkerId(null)}
      />
    </>
  );
}

// Suppress unused warnings when formatPercent is conditionally consumed
void formatPercent;
