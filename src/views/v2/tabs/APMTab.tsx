// APMTab — Application Performance Monitoring.
//
// Sources:
//   - ai_invocations table for latency p50/p95/p99 + throughput + errors
//   - Loki for recent error log lines
// No Grafana iframes. All native.

import { useMemo, useState } from "react";

import { useRangeContext } from "../data/RangeContext.tsx";
import { usePgQuery, useLokiQuery } from "../widgets/useNativeData.ts";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { NativeStat } from "../widgets/NativeStat.tsx";
import { LineChart } from "../widgets/LineChart.tsx";
import { BarList } from "../widgets/BarList.tsx";
import { Sparkline } from "../widgets/Sparkline.tsx";
import { StatusPill } from "../widgets/StatusPill.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";
import { formatCount, formatDurationMs, formatPercent, formatRelativeTime } from "../data/format.ts";
import { displaySourceLabel } from "../data/display.ts";
import { APM_ERROR_SUMMARY_BUDGET, summarizeApmError } from "./apm-error-summary.ts";
import "./APMTab.css";

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sqlSafeSource(s: string): string {
  // The metrics-proxy /api/metrics/pg already gates queries to read-only
  // SELECT statements, but we still strip anything that isn't [a-z0-9._-] so
  // the predicate cannot escape its string literal context.
  return s.replace(/[^a-zA-Z0-9._-]/g, "");
}

export function APMTab() {
  // ── Global range ────────────────────────────────────────────────────
  const { def: rangeDef } = useRangeContext();
  const intervalSql = rangeDef.sqlInterval; // e.g. "6 hours", "7 days"
  const rangeBadge = rangeDef.label.replace(/^Last /, "last ");

  // ── Source filter (NEW) ─────────────────────────────────────────────
  // Discover available sources from the same window, then expose a pill row.
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const sourcesQ = usePgQuery(
    `SELECT source, count(*)::bigint
     FROM ai_invocations
     WHERE ts > now() - interval '${intervalSql}' AND source IS NOT NULL
     GROUP BY source
     ORDER BY 2 DESC
     LIMIT 8`,
    { refetchMs: 60_000 },
  );
  const sourceOptions = useMemo(() => {
    const rows = sourcesQ.data?.rows ?? [];
    return rows.map((r) => String(r[0] ?? "")).filter(Boolean);
  }, [sourcesQ.data]);
  const sourcePredicate = sourceFilter === "all"
    ? ""
    : `AND source = '${sqlSafeSource(sourceFilter)}'`;
  // Choose a bucket width keyed to the window: target ~24-100 buckets.
  // 1h → 1 minute · 6h → 5 minute · 24h → 15 minute · 7d → 1 hour · 30d → 6 hour · mtd → 6 hour.
  const bucketSql: string = (() => {
    switch (rangeDef.key) {
      case "1h":  return "1 minute";
      case "6h":  return "5 minutes";
      case "24h": return "15 minutes";
      case "7d":  return "1 hour";
      case "30d": return "6 hours";
      case "mtd": return "6 hours";
    }
  })();

  // ── Throughput / errors / latency aggregates over the active window ─
  const aggSql = `
    SELECT
      count(*)::bigint AS total,
      sum(case when status = 'error' or status = 'failed' then 1 else 0 end)::bigint AS errors,
      avg(duration_ms) AS avg_ms,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
    FROM ai_invocations
    WHERE ts > now() - interval '${intervalSql}' ${sourcePredicate}
  `;
  const agg = usePgQuery(aggSql, { refetchMs: 30_000 });

  // ── Time-series buckets for line chart ─────────────────────────────
  const seriesSql = `
    SELECT
      date_bin(interval '${bucketSql}', ts, timestamp '2001-01-01') AS bucket,
      count(*)::bigint AS calls,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
    FROM ai_invocations
    WHERE ts > now() - interval '${intervalSql}' ${sourcePredicate}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;
  const series = usePgQuery(seriesSql, { refetchMs: 30_000 });

  // ── Top sources by p95 latency (slowest endpoints) ─────────────────
  const slowSql = `
    SELECT source,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
           count(*)::bigint AS calls
    FROM ai_invocations
    WHERE ts > now() - interval '${intervalSql}' AND duration_ms IS NOT NULL
    GROUP BY source
    HAVING count(*) > 0
    ORDER BY p95 DESC NULLS LAST
    LIMIT 8
  `;
  const slow = usePgQuery(slowSql, { refetchMs: 60_000 });

  // ── Recent errors from Loki, summarized for skimming ───────────────
  const errLogs = useLokiQuery(
    '{job=~".+"} |~ "error|ERROR|fail|panic|fatal"',
    { limit: 20, direction: "backward", refetchMs: 15_000 },
  );

  // ── Aggregate stats ────────────────────────────────────────────────
  const totals = useMemo(() => {
    const row = agg.data?.rows[0];
    if (!row) return null;
    const total = toNum(row[0]);
    const errors = toNum(row[1]);
    const avgMs = toNum(row[2]);
    const p50 = toNum(row[3]);
    const p95 = toNum(row[4]);
    const p99 = toNum(row[5]);
    const errorRate = total > 0 ? errors / total : 0;
    return { total, errors, avgMs, p50, p95, p99, errorRate };
  }, [agg.data]);

  // ── Build line chart series ────────────────────────────────────────
  const chart = useMemo(() => {
    const rows = series.data?.rows ?? [];
    const p50Pts: Array<[number, number]> = [];
    const p95Pts: Array<[number, number]> = [];
    const callPts: Array<[number, number]> = [];
    for (const r of rows) {
      const t = r[0];
      const tMs = typeof t === "string" ? Date.parse(t) : t instanceof Date ? t.getTime() : Number(t);
      if (!Number.isFinite(tMs)) continue;
      callPts.push([tMs, toNum(r[1])]);
      p50Pts.push([tMs, toNum(r[2])]);
      p95Pts.push([tMs, toNum(r[3])]);
    }
    return { p50Pts, p95Pts, callPts };
  }, [series.data]);

  const fmtHour = (n: number) => new Date(n).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const callSpark = chart.callPts.map(([, v]) => v);
  const errorSpark = chart.callPts.length ? chart.callPts.map(([, v]) => v * (totals?.errorRate ?? 0)) : [];
  const recentErrors = useMemo(() => {
    return (errLogs.data ?? []).slice(0, 10).map((entry) => ({
      entry,
      summary: summarizeApmError({ line: entry.line, labels: entry.labels }),
    }));
  }, [errLogs.data]);

  return (
    <>
      <section className="apm-filters" aria-label="APM filters">
        <div className="apm-fgrp" role="group" aria-label="Tool filter">
          <span className="apm-flbl">Show tool</span>
          <div className="apm-pills">
            <button
              type="button"
              className={`apm-pill${sourceFilter === "all" ? " is-on" : ""}`}
              onClick={() => setSourceFilter("all")}
            >
              All tools
            </button>
            {sourceOptions.map((s) => (
              <button
                key={s}
                type="button"
                className={`apm-pill${sourceFilter === s ? " is-on" : ""}`}
                onClick={() => setSourceFilter(s)}
              >
                {displaySourceLabel(s)}
              </button>
            ))}
          </div>
        </div>
        <span className="apm-fnote">
          Showing <b>{rangeBadge}</b> · grouped every <b>{bucketSql}</b>
        </span>
      </section>

      <section className="apm-pulse" aria-label="APM pulse">
        <NativeStat
          title={`Throughput · ${rangeDef.label.replace(/^Last /, "")}`}
          value={totals ? formatCount(totals.total) : "—"}
          unit="calls"
          source={`agent activity · ${rangeBadge}`}
          sub={`average response ${totals ? formatDurationMs(totals.avgMs) : "—"}`}
          loading={agg.isPending}
        />
        <NativeStat
          title={`Error rate · ${rangeDef.label.replace(/^Last /, "")}`}
          value={totals ? formatPercent(totals.errorRate) : "—"}
          source={`agent activity · ${rangeBadge}`}
          sub={`${totals ? formatCount(totals.errors) : "—"} errors`}
          delta={
            totals
              ? { value: totals.errorRate, positive: totals.errorRate < 0.05, label: totals.errors === 0 ? "clean" : "see logs" }
              : undefined
          }
          loading={agg.isPending}
        />
        <WidgetCard title="Slow response threshold" source={`agent activity · ${rangeBadge}`} loading={agg.isPending}>
          <div className="apm-lat-stat">
            <div className="apm-lat-n">{totals ? formatDurationMs(totals.p95) : "—"}</div>
            <div className="apm-lat-sub">
              p50 <b>{totals ? formatDurationMs(totals.p50) : "—"}</b>
              {" · "}p99 <b>{totals ? formatDurationMs(totals.p99) : "—"}</b>
            </div>
          </div>
        </WidgetCard>
        <WidgetCard title="Error trend" source={`agent activity · ${rangeBadge}`} loading={series.isPending}>
          <Sparkline
            points={errorSpark}
            stroke="var(--attn)"
            fill="var(--attn-bg)"
            ariaLabel="Error rate sparkline"
          />
          <div className="apm-err-sub">
            {errorSpark.length} buckets · last {fmtHour(chart.callPts.at(-1)?.[0] ?? Date.now())}
          </div>
        </WidgetCard>
      </section>

      <section className="apm-charts" aria-label="APM trends">
        <WidgetCard title="Response time trend" source={`agent activity · ${rangeBadge}`} loading={series.isPending}>
          {chart.p50Pts.length === 0 ? (
            <EmptyState title="No response-time samples" body="No completed calls reported response times yet" />
          ) : (
            <LineChart
              series={[
                { name: "Median response", color: "var(--accent)", points: chart.p50Pts },
                { name: "Slow response threshold", color: "var(--attn)", points: chart.p95Pts },
              ]}
              height={220}
              yFormat={(v) => formatDurationMs(v)}
              xFormat={fmtHour}
              ariaLabel="Latency p50 vs p95"
            />
          )}
        </WidgetCard>
        <WidgetCard title={`Call volume · every ${bucketSql}`} source={`agent activity · ${rangeBadge}`} loading={series.isPending}>
          {chart.callPts.length === 0 ? (
            <EmptyState title="No invocations recorded" />
          ) : (
            <LineChart
              series={[{ name: "Agent calls", color: "var(--accent)", points: chart.callPts }]}
              height={220}
              yFormat={(v) => formatCount(v)}
              xFormat={fmtHour}
              ariaLabel={`Calls per ${bucketSql} bucket`}
            />
          )}
        </WidgetCard>
      </section>

      <section className="apm-tables" aria-label="APM tables">
        <WidgetCard title="Slowest tools" source={`agent activity · ${rangeBadge}`} loading={slow.isPending}>
          <BarList
            items={(slow.data?.rows ?? []).map((r) => ({
              label: displaySourceLabel(String(r[0] ?? "")),
              value: toNum(r[1]),
              sub: `${formatCount(toNum(r[2]))} calls`,
            }))}
            valueFormat={(v) => formatDurationMs(v)}
            color="var(--attn)"
            emptyLabel="No latency samples"
          />
        </WidgetCard>
        <WidgetCard title="Recent errors" source="summarized log search" loading={errLogs.isPending}>
          {recentErrors.length === 0 ? (
            <EmptyState title="No errors in the last hour" body="Log search found no error, failure, panic, or fatal messages" />
          ) : (
            <ol className="apm-err-list">
              {recentErrors.map(({ entry: e, summary }, i) => (
                <li key={`${e.ts}-${i}`}>
                  <span className="apm-err-meta">
                    <StatusPill state="alert" label={summary.severity} />
                    <span className="apm-err-ts">{formatRelativeTime(e.ts)}</span>
                    <span className="apm-err-job">{summary.subsystem}</span>
                  </span>
                  <strong className="apm-err-title">{summary.primary}</strong>
                  <span className="apm-err-explain">{summary.meaning}</span>
                  {summary.likelyCause ? (
                    <span className="apm-err-cause">Likely cause: {summary.likelyCause}</span>
                  ) : null}
                  <span className="apm-err-budget" title={APM_ERROR_SUMMARY_BUDGET.label}>
                    {summary.budget.inputTokens} in / {summary.budget.outputTokens} out token cap
                  </span>
                  <details className="apm-err-raw">
                    <summary>Original log line</summary>
                    <code>{summary.raw}</code>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </WidgetCard>
      </section>
    </>
  );
}
