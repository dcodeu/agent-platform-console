// Wall — the /wall NOC big-board layout.
//
// CSS Grid: 2 cols (main + 320px ticker). Inside main we stack:
//   row 1 — header (brand, health pill, live clock)
//   row 2 — SLO row (7 native tiles)
//   row 3 — Token-flow strip (single wide LineChart)
//   row 4 — Chart band (3 wide native LineCharts)
//   row 5 — Bottom strip (4 tiles: container health, recent alerts,
//           codex pool)
//   row 6 — footer plate
//
// Native-only: every tile is a NativeStat / LineChart / Sparkline composed
// from the shared widget kit. NO iframes, NO Grafana embeds. Data comes
// from /api/ops/heavy.json (snapshot+heavy), /api/metrics/prom and
// /api/metrics/pg via TanStack Query hooks.
//
// Alert-zoom: each SLO tile is wrapped in <ZoomShell panelKey=...>. When an
// alert.created SSE event maps to a panel key, that shell pulses a coral
// glow for 30s. (No transform-scale — neighbours would overlap on a fixed
// grid.)

import { useEffect, useMemo, useState } from "react";

import { useAlerts, useHeavy, useSnapshot, type AlertItem } from "../data/queries.ts";
import { usePromInstant, usePromQuery, usePgQuery } from "../widgets/useNativeData.ts";
import { NativeStat } from "../widgets/NativeStat.tsx";
import { LineChart } from "../widgets/LineChart.tsx";
import { Sparkline } from "../widgets/Sparkline.tsx";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";
import { formatCount, formatPercent, formatDurationMs, formatTokens, formatRelativeTime } from "../data/format.ts";
import { AlertZoomProvider, ZoomShell } from "./AlertZoom.tsx";
import { Ticker } from "./Ticker.tsx";

import "./wall.css";

/** Live wall clock that updates once per second. */
function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function fmtClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function fmtDate(d: Date): string {
  const wk = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return `${wk} · ${mo} ${d.getDate()}, ${d.getFullYear()} · ET`;
}

/** Derive an overall health label from the current alert list. */
function deriveHealth(alerts: AlertItem[] | undefined): {
  label: string;
  className: "" | "degraded" | "alert";
} {
  if (!alerts || alerts.length === 0) {
    return { label: "NOMINAL", className: "" };
  }
  const crit = alerts.filter((a) => a.severity === "critical").length;
  const warn = alerts.filter((a) => a.severity === "warn").length;
  if (crit > 0) {
    return { label: `ALERT · ${crit} critical${warn ? ` · ${warn} warn` : ""}`, className: "alert" };
  }
  if (warn > 0) {
    return { label: `DEGRADED · ${warn} advisor${warn === 1 ? "y" : "ies"}`, className: "degraded" };
  }
  return { label: `NOMINAL · ${alerts.length} info`, className: "" };
}

/** Format a HH:00 label for an x-tick (epoch ms → "14h" local). */
function fmtHour(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getHours())}h`;
}

/** Classify a docker container row as ok / warn / bad by status string. */
function dockerHealth(status: string): "ok" | "warn" | "bad" {
  const s = status.toLowerCase();
  if (s.includes("unhealthy") || s.includes("exited") || s.includes("dead")) return "bad";
  if (s.includes("restarting") || s.includes("starting") || s.includes("paused")) return "warn";
  if (s.includes("up")) return "ok";
  return "warn";
}

export function Wall() {
  const now = useNow(1000);
  const alertsQ = useAlerts();
  const heavy = useHeavy();
  const snapshot = useSnapshot();
  const [latestAlert, setLatestAlert] = useState<AlertItem | null>(null);

  // Seed AlertZoom with the most recent alert so the feature still works on
  // initial page load even if no SSE event arrives.
  const seededLatest = useMemo<AlertItem | null>(() => {
    const items = alertsQ.data?.alerts ?? [];
    return items.find((a) => a.severity === "critical") ?? items.find((a) => a.severity === "warn") ?? null;
  }, [alertsQ.data]);

  useEffect(() => {
    if (latestAlert) return;
    if (seededLatest) setLatestAlert(seededLatest);
  }, [seededLatest, latestAlert]);

  const health = deriveHealth(alertsQ.data?.alerts);

  // ── Kuma · monitors UP ───────────────────────────────────────────────
  const upstream = heavy.data?.upstream ?? [];
  const kumaUp = upstream.filter((u) => u.ok).length;
  const kumaTotal = upstream.length;
  const kumaDown = kumaTotal - kumaUp;

  // ── AI · success · 24h ───────────────────────────────────────────────
  const aiSuccess = usePgQuery(
    "SELECT " +
      "count(*) FILTER (WHERE status NOT IN ('failed','error')) AS ok, " +
      "count(*) AS total " +
      "FROM ai_invocations WHERE ts > now() - interval '24 hours'",
    { refetchMs: 30_000 },
  );
  const aiSuccessPrev = usePgQuery(
    "SELECT " +
      "count(*) FILTER (WHERE status NOT IN ('failed','error')) AS ok, " +
      "count(*) AS total " +
      "FROM ai_invocations WHERE ts > now() - interval '48 hours' " +
      "AND ts <= now() - interval '24 hours'",
    { refetchMs: 30_000 },
  );
  const aiRow = aiSuccess.data?.rows[0];
  const aiPrevRow = aiSuccessPrev.data?.rows[0];
  const aiOk = aiRow ? Number(aiRow[0]) : null;
  const aiTotal = aiRow ? Number(aiRow[1]) : null;
  const aiRate = aiOk != null && aiTotal != null && aiTotal > 0 ? aiOk / aiTotal : null;
  const aiPrevOk = aiPrevRow ? Number(aiPrevRow[0]) : null;
  const aiPrevTotal = aiPrevRow ? Number(aiPrevRow[1]) : null;
  const aiPrevRate = aiPrevOk != null && aiPrevTotal != null && aiPrevTotal > 0 ? aiPrevOk / aiPrevTotal : null;
  const aiDelta = aiRate != null && aiPrevRate != null ? aiRate - aiPrevRate : null;

  // ── Host · CPU ───────────────────────────────────────────────────────
  const cpuQ = "100 - (avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)";
  const cpuInstant = usePromInstant(cpuQ, { refetchMs: 10_000 });
  const cpuRange = usePromQuery(cpuQ, { refetchMs: 30_000, step: 60 });
  const cpuVal = cpuInstant.data?.[0]?.value ?? null;
  const cpuSpark = useMemo<number[]>(() => {
    const s = cpuRange.data?.[0]?.values ?? [];
    return s.map(([, v]) => v);
  }, [cpuRange.data]);

  // ── Postgres · cache hit ─────────────────────────────────────────────
  const pgCache = usePgQuery(
    "SELECT sum(blks_hit)::float / nullif(sum(blks_hit + blks_read), 0) AS hit FROM pg_stat_database",
    { refetchMs: 30_000 },
  );
  const pgHitRaw = pgCache.data?.rows[0]?.[0];
  const pgHit = pgHitRaw != null ? Number(pgHitRaw) : null;

  // ── Tokens · 24h (NEW) ───────────────────────────────────────────────
  // Sum input+output tokens over the last 24h from ai_invocations. We also
  // pull yesterday's slice for the delta chip.
  const tokens24h = usePgQuery(
    "SELECT coalesce(sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)),0)::bigint AS toks, " +
      "count(*)::bigint AS calls " +
      "FROM ai_invocations WHERE ts > now() - interval '24 hours'",
    { refetchMs: 30_000 },
  );
  const tokensPrev = usePgQuery(
    "SELECT coalesce(sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)),0)::bigint AS toks " +
      "FROM ai_invocations " +
      "WHERE ts > now() - interval '48 hours' AND ts <= now() - interval '24 hours'",
    { refetchMs: 30_000 },
  );
  const tokens24Total = tokens24h.data?.rows[0]?.[0] != null ? Number(tokens24h.data.rows[0][0]) : null;
  const tokens24Calls = tokens24h.data?.rows[0]?.[1] != null ? Number(tokens24h.data.rows[0][1]) : null;
  const tokensPrevTotal = tokensPrev.data?.rows[0]?.[0] != null ? Number(tokensPrev.data.rows[0][0]) : null;
  const tokensDelta =
    tokens24Total != null && tokensPrevTotal != null && tokensPrevTotal > 0
      ? (tokens24Total - tokensPrevTotal) / tokensPrevTotal
      : null;

  // ── Active sessions (NEW) ────────────────────────────────────────────
  const activeSessions = heavy.data?.hermes.status?.active_sessions ?? null;
  const totalSessionsToday = heavy.data?.tokens.today ? heavy.data.tokens.today.total : null;

  // ── Token flow · 24h hourly · 4 series (NEW) ─────────────────────────
  // We rely on hermes daily as the most reliable cache_read/reasoning source,
  // but heavy.tokens.daily is per-day, not per-hour. For an hourly time-series
  // strip we fall back to ai_invocations per-hour (input+output only — that
  // table doesn't store cache_read / reasoning today).
  const tokenHourly = usePgQuery(
    "SELECT date_trunc('hour', ts) AS bucket, " +
      "coalesce(sum(input_tokens),0)::bigint AS input, " +
      "coalesce(sum(output_tokens),0)::bigint AS output " +
      "FROM ai_invocations " +
      "WHERE ts > now() - interval '24 hours' " +
      "GROUP BY 1 ORDER BY 1",
    { refetchMs: 60_000 },
  );
  const tokenFlowSeries = useMemo(() => {
    const rows = tokenHourly.data?.rows ?? [];
    const input: Array<[number, number]> = [];
    const output: Array<[number, number]> = [];
    const cache: Array<[number, number]> = [];
    const reasoning: Array<[number, number]> = [];
    for (const [bucket, inTok, outTok] of rows) {
      const t = typeof bucket === "string" ? Date.parse(bucket) : Number(bucket);
      if (!Number.isFinite(t)) continue;
      const iN = Number(inTok);
      const oN = Number(outTok);
      if (Number.isFinite(iN)) input.push([t, iN]);
      if (Number.isFinite(oN)) output.push([t, oN]);
    }
    // Best-effort cache_read & reasoning: spread Hermes daily totals evenly
    // across the day's hours so the strip never looks empty when daily
    // numbers do exist. (Producers will eventually backfill the column.)
    const daily = heavy.data?.tokens.daily ?? [];
    for (const d of daily) {
      const dayMs = Date.parse(`${d.day}T00:00:00Z`);
      if (!Number.isFinite(dayMs)) continue;
      const perHourC = d.cache_read / 24;
      const perHourR = d.reasoning / 24;
      for (let h = 0; h < 24; h += 1) {
        const t = dayMs + h * 3600_000;
        if (t < Date.now() - 24 * 3600_000) continue;
        if (perHourC > 0) cache.push([t, perHourC]);
        if (perHourR > 0) reasoning.push([t, perHourR]);
      }
    }
    return [
      { name: "Input tokens", color: "var(--accent)", points: input },
      { name: "Output tokens", color: "var(--attn)", points: output },
      { name: "Cache reads", color: "var(--viz-dim)", points: cache },
      { name: "reasoning", color: "var(--alert)", points: reasoning },
    ];
  }, [tokenHourly.data, heavy.data]);

  // ── Invocations · hourly (last 24h) ──────────────────────────────────
  const invHourly = usePgQuery(
    "SELECT date_trunc('hour', ts) AS bucket, count(*) AS n " +
      "FROM ai_invocations " +
      "WHERE ts > now() - interval '24 hours' " +
      "GROUP BY 1 ORDER BY 1",
    { refetchMs: 30_000 },
  );
  const invSeries = useMemo(() => {
    const rows = invHourly.data?.rows ?? [];
    const points: Array<[number, number]> = [];
    for (const [bucket, count] of rows) {
      const t = typeof bucket === "string" ? Date.parse(bucket) : Number(bucket);
      const n = Number(count);
      if (Number.isFinite(t) && Number.isFinite(n)) points.push([t, n]);
    }
    return [{ name: "invocations", color: "var(--accent)", points }];
  }, [invHourly.data]);

  // ── Latency · p50/p95/p99 (last 7d hourly — duration_ms is sparse) ──
  const latencyHourly = usePgQuery(
    "SELECT date_trunc('hour', ts) AS bucket, " +
      "percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50, " +
      "percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95, " +
      "percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99 " +
      "FROM ai_invocations " +
      "WHERE ts > now() - interval '7 days' AND duration_ms IS NOT NULL " +
      "GROUP BY 1 ORDER BY 1",
    { refetchMs: 30_000 },
  );
  const latencySeries = useMemo(() => {
    const rows = latencyHourly.data?.rows ?? [];
    const p50: Array<[number, number]> = [];
    const p95: Array<[number, number]> = [];
    const p99: Array<[number, number]> = [];
    for (const [bucket, a, b, c] of rows) {
      const t = typeof bucket === "string" ? Date.parse(bucket) : Number(bucket);
      if (!Number.isFinite(t)) continue;
      if (a != null) p50.push([t, Number(a)]);
      if (b != null) p95.push([t, Number(b)]);
      if (c != null) p99.push([t, Number(c)]);
    }
    return [
      { name: "Median response", color: "var(--accent)", points: p50 },
      { name: "Slow response threshold", color: "var(--attn)", points: p95 },
      { name: "Worst response band", color: "var(--alert)", points: p99 },
    ];
  }, [latencyHourly.data]);

  // ── Token rate per source · 24h (NEW) ────────────────────────────────
  // Hourly stacked LineChart over top 4 sources by total tokens.
  const tokenBySource = usePgQuery(
    "SELECT source, date_trunc('hour', ts) AS bucket, " +
      "coalesce(sum(coalesce(input_tokens,0) + coalesce(output_tokens,0)),0)::bigint AS toks " +
      "FROM ai_invocations " +
      "WHERE ts > now() - interval '24 hours' AND source IS NOT NULL " +
      "GROUP BY 1, 2 ORDER BY 2",
    { refetchMs: 60_000 },
  );
  const tokenSourceSeries = useMemo(() => {
    const rows = tokenBySource.data?.rows ?? [];
    // Aggregate by source so we can pick top 4.
    const totalsBySource = new Map<string, number>();
    for (const [src, , toks] of rows) {
      const s = String(src ?? "(none)");
      const v = Number(toks);
      if (!Number.isFinite(v)) continue;
      totalsBySource.set(s, (totalsBySource.get(s) ?? 0) + v);
    }
    const top4 = Array.from(totalsBySource.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([s]) => s);
    const palette = ["var(--accent)", "var(--attn)", "var(--viz-dim)", "var(--alert)"];
    const byKey = new Map<string, Array<[number, number]>>();
    for (const s of top4) byKey.set(s, []);
    for (const [src, bucket, toks] of rows) {
      const s = String(src ?? "(none)");
      if (!byKey.has(s)) continue;
      const t = typeof bucket === "string" ? Date.parse(bucket as string) : Number(bucket);
      const v = Number(toks);
      if (Number.isFinite(t) && Number.isFinite(v)) byKey.get(s)!.push([t, v]);
    }
    return top4.map((s, i) => ({
      name: s.length > 14 ? `${s.slice(0, 12)}…` : s,
      color: palette[i] ?? "var(--fg-3)",
      points: byKey.get(s) ?? [],
    }));
  }, [tokenBySource.data]);

  // ── Container health (NEW) ───────────────────────────────────────────
  const containers = snapshot.data?.docker ?? [];
  const worstContainers = useMemo(() => {
    // Rank by health bucket (bad → warn → ok), then alphabetical, take 4.
    const ranked = containers.slice().sort((a, b) => {
      const ha = dockerHealth(a.status);
      const hb = dockerHealth(b.status);
      const rank = (h: string) => (h === "bad" ? 0 : h === "warn" ? 1 : 2);
      if (rank(ha) !== rank(hb)) return rank(ha) - rank(hb);
      return a.name.localeCompare(b.name);
    });
    return ranked.slice(0, 4);
  }, [containers]);

  // ── Recent alerts (NEW) — last 3 ────────────────────────────────────
  const recentAlerts = (alertsQ.data?.alerts ?? []).slice(0, 3);

  // ── Codex pool grid (NEW) ────────────────────────────────────────────
  const codexPool = snapshot.data?.agents.codexPool ?? [];
  const codexCells = useMemo(() => {
    if (codexPool.length === 0) {
      return Array.from({ length: 11 }, (_, i) => ({
        id: `codex-${String(i + 1).padStart(2, "0")}`,
        ok: false,
        idle: true,
      }));
    }
    return codexPool.slice(0, 11).map((w) => ({
      id: w.id,
      ok: w.authState === "valid" && w.enabled,
      idle: w.authState !== "valid" || !w.enabled,
    }));
  }, [codexPool]);
  const codexReady = codexCells.filter((c) => c.ok).length;

  const heavyLoading = heavy.isPending;

  return (
    <AlertZoomProvider latestAlert={latestAlert}>
      <div className="wall">
        <main className="wall-main">
          {/* ── header ───────────────────────────────────────── */}
          <header className="wall-head">
            <div className="wall-brand">
              <span className="wall-glyph">A</span>
              <h1>
                Agent Platform <small>/wall · NOC</small>
              </h1>
            </div>
            <span className={`wall-health ${health.className}`}>
              <span className="pulse" /> {health.label}
            </span>
            <div className="wall-clock">
              <div className="time">{fmtClock(now)}</div>
              <div className="date">{fmtDate(now)}</div>
            </div>
          </header>

          {/* ── SLO row (7 native tiles) ───────────────────── */}
          <section className="wall-slos" aria-label="Service-level indicators">
            <ZoomShell panelKey="kumaUp">
              <NativeStat
                title="Monitors online"
                value={kumaTotal > 0 ? `${kumaUp}` : "—"}
                unit={kumaTotal > 0 ? `/ ${kumaTotal}` : undefined}
                source="monitor checks"
                sub={kumaDown > 0 ? `${kumaDown} down` : "all healthy"}
                delta={
                  kumaTotal > 0
                    ? { value: kumaDown, positive: kumaDown === 0, label: kumaDown === 0 ? "OK" : `-${kumaDown}` }
                    : undefined
                }
                loading={heavyLoading}
              />
            </ZoomShell>
            <ZoomShell panelKey="successRate24h">
              <NativeStat
                title="Agent success in the last 24 hours"
                value={aiRate != null ? formatPercent(aiRate) : "—"}
                source="agent activity · last 24 hours"
                sub={aiTotal != null ? `${formatCount(aiTotal)} calls` : "no data"}
                delta={
                  aiDelta != null && Math.abs(aiDelta) > 0.0001
                    ? {
                        value: aiDelta,
                        positive: aiDelta >= 0,
                        label: `${aiDelta >= 0 ? "+" : ""}${(aiDelta * 100).toFixed(1)}pp`,
                      }
                    : undefined
                }
                loading={aiSuccess.isPending}
              />
            </ZoomShell>
            <ZoomShell panelKey="hostCpu">
              <WidgetCard
                title="Processor use"
                source="server metrics · last 5 minutes"
                loading={cpuInstant.isPending}
              >
                <div className="wall-cpu">
                  <div className="wall-cpu-n">
                    <span className="wall-cpu-num">
                      {cpuVal != null ? cpuVal.toFixed(1) : "—"}
                    </span>
                    <span className="wall-cpu-unit">%</span>
                  </div>
                  <Sparkline
                    points={cpuSpark}
                    height={36}
                    ariaLabel="Host CPU last 30 minutes"
                  />
                </div>
              </WidgetCard>
            </ZoomShell>
            <ZoomShell panelKey="pgCacheHit">
              <NativeStat
                title="Database reads from memory"
                value={pgHit != null ? formatPercent(pgHit) : "—"}
                source="database metrics · live now"
                sub="reads served from memory"
                delta={
                  pgHit != null
                    ? {
                        value: pgHit,
                        positive: pgHit >= 0.99,
                        label: pgHit >= 0.99 ? "≥99%" : "low",
                      }
                    : undefined
                }
                loading={pgCache.isPending}
              />
            </ZoomShell>
            <ZoomShell panelKey="tokens24h">
              <NativeStat
                title="Tokens used in the last 24 hours"
                value={tokens24Total != null ? formatTokens(tokens24Total) : "—"}
                source="agent activity · last 24 hours"
                sub={tokens24Calls != null ? `${formatCount(tokens24Calls)} calls` : "—"}
                delta={
                  tokensDelta != null
                    ? {
                        value: tokensDelta,
                        positive: tokensDelta >= 0,
                        label: `${tokensDelta >= 0 ? "+" : ""}${(tokensDelta * 100).toFixed(1)}%`,
                      }
                    : undefined
                }
                loading={tokens24h.isPending}
              />
            </ZoomShell>
            <ZoomShell panelKey="activeSessions">
              <NativeStat
                title="Sessions running now"
                value={activeSessions != null ? formatCount(activeSessions) : "—"}
                source="agent sessions · live now"
                sub={totalSessionsToday != null ? `${formatTokens(totalSessionsToday)} tokens today` : "—"}
                loading={heavyLoading}
              />
            </ZoomShell>
          </section>

          {/* ── Token-flow strip (single wide LineChart, NEW) ─ */}
          <section className="wall-tokens" aria-label="Token flow 24h">
            <WidgetCard
              title="Token flow in the last 24 hours"
              source="token totals · last 24 hours"
              loading={tokenHourly.isPending}
            >
              {tokenFlowSeries.every((s) => s.points.length === 0) ? (
                <EmptyState title="No token activity" body="No agent token records in the last 24 hours." />
              ) : (
                <LineChart
                  series={tokenFlowSeries}
                  height={140}
                  yFormat={(v) => formatTokens(v)}
                  xFormat={fmtHour}
                  ariaLabel="Token flow over last 24 hours, 4 series"
                />
              )}
            </WidgetCard>
          </section>

          {/* ── Chart band (3 wide native LineCharts) ───────── */}
          <section className="wall-charts" aria-label="Throughput, latency, sources">
            <WidgetCard
              title="Hourly agent calls"
              source="agent activity · last 24 hours"
              loading={invHourly.isPending}
            >
              {invSeries[0].points.length === 0 ? (
                <EmptyState title="No agent calls" body="Nothing logged in the last 24 hours." />
              ) : (
                <LineChart
                  series={invSeries}
                  height={180}
                  yFormat={(v) => formatCount(v)}
                  xFormat={fmtHour}
                  ariaLabel="Invocations per hour over last 24 hours"
                  legend={false}
                />
              )}
            </WidgetCard>
            <WidgetCard
              title="Response time trend"
              source="agent activity · last 7 days"
              loading={latencyHourly.isPending}
            >
              {latencySeries.every((s) => s.points.length === 0) ? (
                <EmptyState
                  title="No response-time samples"
                  body="No completed calls reported response times yet."
                />
              ) : (
                <LineChart
                  series={latencySeries}
                  height={180}
                  yFormat={(v) => formatDurationMs(v)}
                  xFormat={(t) =>
                    new Date(t).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                  ariaLabel="Latency percentiles over last 7 days"
                />
              )}
            </WidgetCard>
            <WidgetCard
              title="Token rate by top tools"
              source="agent activity · last 24 hours"
              loading={tokenBySource.isPending}
            >
              {tokenSourceSeries.every((s) => s.points.length === 0) ? (
                <EmptyState
                  title="No token data by tool"
                  body="Recent agent call records do not include a tool label yet."
                />
              ) : (
                <LineChart
                  series={tokenSourceSeries}
                  height={180}
                  yFormat={(v) => formatTokens(v)}
                  xFormat={fmtHour}
                  ariaLabel="Tokens per hour by top sources"
                />
              )}
            </WidgetCard>
          </section>

          {/* ── Bottom strip (4 cells, NEW) ───────────────────── */}
          <section className="wall-bottom" aria-label="Container health, alerts, n8n flux, codex">
            {/* Container health */}
            <WidgetCard title="Containers needing attention" source={`container status · ${containers.length}`} loading={snapshot.isPending}>
              {worstContainers.length === 0 ? (
                <EmptyState title="No containers" />
              ) : (
                <ul className="wall-cont-list">
                  {worstContainers.map((c) => {
                    const h = dockerHealth(c.status);
                    return (
                      <li key={c.name} className={`wall-cont wall-cont-${h}`}>
                        <span className={`wall-cont-dot ${h}`} />
                        <span className="wall-cont-name">{c.name}</span>
                        <span className="wall-cont-status">{c.status}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </WidgetCard>
            {/* Recent alerts */}
            <WidgetCard title="Recent alerts" source={`alert feed · ${alertsQ.data?.alerts.length ?? 0}`} loading={alertsQ.isPending}>
              {recentAlerts.length === 0 ? (
                <EmptyState title="All clear" body="No active alerts." />
              ) : (
                <ul className="wall-alerts-list">
                  {recentAlerts.map((a) => (
                    <li key={a.id} className={`wall-alert wall-alert-${a.severity}`}>
                      <span className={`wall-alert-sev sev-${a.severity}`}>{a.severity}</span>
                      <span className="wall-alert-title">{a.title}</span>
                      {a.sinceMs != null ? (
                        <span className="wall-alert-since">{formatRelativeTime(Date.now() - a.sinceMs)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </WidgetCard>
            {/* Codex pool mini grid */}
            <WidgetCard title="Codex pool" source={`LRU · ${codexReady}/${codexCells.length} ready`} loading={snapshot.isPending}>
              <div className="wall-codex-grid">
                {codexCells.map((c) => (
                  <span
                    key={c.id}
                    className={`wall-codex-cell ${c.ok ? "is-ok" : "is-quar"}`}
                    title={`${c.id} · ${c.ok ? "ready" : "quarantined"}`}
                  />
                ))}
              </div>
            </WidgetCard>
          </section>

          {/* ── Footer plate ───────────────────────────────── */}
          <footer className="wall-foot">
            <span>SRC <b>prometheus · loki · postgres</b></span>
            <span>REFRESH <b>5s · live</b></span>
            <span>TZ <b>ET · store UTC</b></span>
            <span style={{ marginLeft: "auto" }}>
              AGENT PLATFORM · /wall · READ-ONLY · alert-zoom enabled
            </span>
          </footer>
        </main>

        {/* ── Right rail ─────────────────────────────────── */}
        <Ticker onAlert={setLatestAlert} />
      </div>
    </AlertZoomProvider>
  );
}
