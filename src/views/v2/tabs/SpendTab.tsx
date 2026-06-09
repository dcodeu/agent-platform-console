// SpendTab — TOKEN-ONLY (no $).
//
// Headline (MTD/today/daily avg) → token flow chart → composition
// → by source/model/agent BarLists → cache-efficiency Gauge.

import { useMemo } from "react";

import { useHeavy } from "../data/queries.ts";
import { useRangeContext } from "../data/RangeContext.tsx";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { NativeStat } from "../widgets/NativeStat.tsx";
import { LineChart } from "../widgets/LineChart.tsx";
import { BarList } from "../widgets/BarList.tsx";
import { Gauge } from "../widgets/Gauge.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";
import { NativeTable, type NativeTableColumn } from "../widgets/NativeTable.tsx";
import { usePgQuery } from "../widgets/useNativeData.ts";
import { formatCount, formatTokens, formatRelativeTime } from "../data/format.ts";
import { displayMetricLabel, displaySourceLabel } from "../data/display.ts";
import "./SpendTab.css";

// SQL for Codex panels 20, 21, 22 — mirrored from
// observability/grafana/provisioning/dashboards/ai-invocations-v2.json
// (panel ids 20/21/22). The Grafana ${source:sqlstring} template variable
// is inlined to "all sources" so the panel matches the SpendTab scope.
//
// The Grafana panels reference `total_tokens` and `cache_read_tokens`
// columns that don't yet exist in the ai_invocations table — the actual
// schema only has input_tokens + output_tokens. We compute total_tokens as
// (input + output) here so the panels actually render. Cache_read trend is
// pinned to 0 until the column lands; when it does, swap the CASE expr to
// the original.
const TOKEN_FLOW_BY_SOURCE_SQL = `
  SELECT date_trunc('hour', ts) AS time,
         source AS metric,
         COALESCE(sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS value
  FROM ai_invocations
  WHERE ts > now() - interval '24 hours'
  GROUP BY 1, 2
  ORDER BY 1
`.trim();

const CACHE_READ_TREND_SQL = `
  SELECT date_trunc('hour', ts) AS time,
         'cache_read_efficiency' AS metric,
         0::float AS value
  FROM ai_invocations
  WHERE ts > now() - interval '7 days'
  GROUP BY 1
  ORDER BY 1
`.trim();

const TOP_COSTLY_SQL = `
  SELECT source,
         model,
         (COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))::bigint AS total_tokens,
         ts AS started_at
  FROM ai_invocations
  WHERE ts > now() - interval '24 hours'
  ORDER BY (COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) DESC NULLS LAST
  LIMIT 50
`.trim();

interface TopCostlyRow extends Record<string, unknown> {
  source: string;
  model: string;
  total_tokens: number;
  started_at: string;
}

const TOP_COSTLY_COLUMNS: Array<NativeTableColumn<TopCostlyRow>> = [
  { key: "source", label: "Tool" },
  { key: "model", label: "Model", dim: true },
  {
    key: "total_tokens",
    label: "Tokens",
    align: "right",
    format: (v) => formatTokens(Number(v ?? 0)),
  },
  {
    key: "started_at",
    label: "Started",
    align: "right",
    dim: true,
    format: (v) => formatRelativeTime(typeof v === "string" ? v : String(v)),
  },
];

export function SpendTab() {
  const heavy = useHeavy();
  const loading = heavy.isPending;
  const tokens = heavy.data?.tokens;
  const { def: rangeDef } = useRangeContext();
  // SpendTab is fed by server-aggregated daily buckets, so we can't actually
  // shrink the window below "30d" without an API change — but the caption
  // tracks the global range so the chrome stays consistent.
  const rangeShort = rangeDef.label.replace(/^Last /, "");

  // Daily average across days seen so far this month (defensive: clamp to 1).
  const dayOfMonth = new Date().getUTCDate();
  const priorDays = Math.max(1, dayOfMonth);
  const dailyAvg = (tokens?.mtd.total ?? 0) / priorDays;

  // Chart series — input / output / cache_read / reasoning.
  // Server provides up to 30 daily buckets; clip to fit the active range.
  const chart = useMemo(() => {
    const days = tokens?.daily ?? [];
    const series: Array<{ name: string; color: string; points: Array<[number, number]> }> = [
      { name: "Input tokens", color: "var(--accent)", points: [] },
      { name: "Output tokens", color: "var(--attn)", points: [] },
      { name: "Cache reads", color: "var(--viz-dim)", points: [] },
      { name: "Reasoning tokens", color: "var(--fg-2)", points: [] },
    ];
    const cutoffMs = Date.now() - rangeDef.durationSec * 1000;
    for (const d of days) {
      const t = Date.parse(d.day + "T00:00:00Z");
      if (!Number.isFinite(t)) continue;
      if (rangeDef.key !== "mtd" && t < cutoffMs) continue;
      series[0].points.push([t, d.input]);
      series[1].points.push([t, d.output]);
      series[2].points.push([t, d.cache_read]);
      series[3].points.push([t, d.reasoning]);
    }
    return series;
  }, [tokens?.daily, rangeDef]);

  // ── Codex-mirrored panels ─────────────────────────────────────────
  const flowBySource = usePgQuery(TOKEN_FLOW_BY_SOURCE_SQL, { refetchMs: 60_000 });
  const cacheTrend = usePgQuery(CACHE_READ_TREND_SQL, { refetchMs: 60_000 });
  const topCostly = usePgQuery(TOP_COSTLY_SQL, { refetchMs: 60_000 });

  // Pivot {time, metric, value} rows → multi-series for LineChart.
  const flowSourceSeries = useMemo(() => {
    const data = flowBySource.data;
    if (!data || data.rows.length === 0) return [];
    const ci = data.columns.indexOf("time");
    const mi = data.columns.indexOf("metric");
    const vi = data.columns.indexOf("value");
    if (ci < 0 || mi < 0 || vi < 0) return [];
    const buckets = new Map<string, Array<[number, number]>>();
    for (const r of data.rows) {
      const tsRaw = r[ci];
      const metric = String(r[mi] ?? "");
      const v = Number(r[vi]);
      if (!metric || !Number.isFinite(v)) continue;
      const ms = typeof tsRaw === "string" ? Date.parse(tsRaw) : Number(tsRaw);
      if (!Number.isFinite(ms)) continue;
      const arr = buckets.get(metric) ?? [];
      arr.push([ms, v]);
      buckets.set(metric, arr);
    }
    const COLORS = ["var(--accent)", "var(--attn)", "var(--viz-dim)", "var(--fg-2)", "var(--alert)"];
    const out: Array<{ name: string; color: string; points: Array<[number, number]> }> = [];
    let i = 0;
    for (const [name, points] of buckets) {
      points.sort((a, b) => a[0] - b[0]);
      out.push({ name: displaySourceLabel(name), color: COLORS[i % COLORS.length], points });
      i++;
    }
    out.sort((a, b) => {
      const aMax = a.points.reduce((m, [, y]) => Math.max(m, y), 0);
      const bMax = b.points.reduce((m, [, y]) => Math.max(m, y), 0);
      return bMax - aMax;
    });
    return out;
  }, [flowBySource.data]);

  const cacheTrendSeries = useMemo(() => {
    const data = cacheTrend.data;
    if (!data || data.rows.length === 0) return [];
    const ci = data.columns.indexOf("time");
    const vi = data.columns.indexOf("value");
    if (ci < 0 || vi < 0) return [];
    const points: Array<[number, number]> = [];
    for (const r of data.rows) {
      const tsRaw = r[ci];
      const v = Number(r[vi]);
      if (!Number.isFinite(v)) continue;
      const ms = typeof tsRaw === "string" ? Date.parse(tsRaw) : Number(tsRaw);
      if (!Number.isFinite(ms)) continue;
      points.push([ms, v]);
    }
    points.sort((a, b) => a[0] - b[0]);
    return [{ name: "Cache read efficiency", color: "var(--accent)", points }];
  }, [cacheTrend.data]);

  const topCostlyRows = useMemo<TopCostlyRow[]>(() => {
    const data = topCostly.data;
    if (!data || data.rows.length === 0) return [];
    const idx = Object.fromEntries(data.columns.map((c, i) => [c, i]));
    return data.rows.map((r) => ({
      source: String(r[idx.source] ?? ""),
      model: String(r[idx.model] ?? ""),
      total_tokens: Number(r[idx.total_tokens] ?? 0),
      started_at: String(r[idx.started_at] ?? ""),
    }));
  }, [topCostly.data]);

  // Composition (MTD) as BarList
  const composition = useMemo(() => {
    const m = tokens?.mtd ?? { input: 0, output: 0, cache_read: 0, reasoning: 0, total: 0 };
    return [
      { label: displayMetricLabel("input"), value: m.input },
      { label: displayMetricLabel("output"), value: m.output },
      { label: displayMetricLabel("cache_read"), value: m.cache_read },
      { label: "Reasoning tokens", value: m.reasoning },
    ];
  }, [tokens?.mtd]);

  return (
    <>
      <section className="sp-pulse" aria-label="Spend pulse">
        <NativeStat
          title="Tokens used this month"
          value={formatTokens(tokens?.mtd.total ?? 0)}
          source="token totals · month to date"
          sub={`cache reads ${formatTokens(tokens?.mtd.cache_read ?? 0)}`}
          loading={loading}
        />
        <NativeStat
          title="Tokens used today"
          value={formatTokens(tokens?.today.total ?? 0)}
          source="token totals · last 24 hours"
          sub={`in ${formatTokens(tokens?.today.input ?? 0)} · out ${formatTokens(tokens?.today.output ?? 0)}`}
          loading={loading}
        />
        <NativeStat
          title="Daily avg"
          value={formatTokens(Math.round(dailyAvg))}
          source="month to date average"
          sub={`${priorDays} days`}
          loading={loading}
        />
      </section>

      <section className="sp-chart" aria-label="Token flow">
        <WidgetCard title={`Token flow · ${rangeShort}`} source="daily token totals" loading={loading}>
          {chart[0].points.length === 0 ? (
            <EmptyState title="No daily token data yet" />
          ) : (
            <LineChart
              series={chart}
              height={240}
              yFormat={(v) => formatTokens(v)}
              xFormat={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              ariaLabel="Token flow across daily buckets"
            />
          )}
        </WidgetCard>
      </section>

      <section className="sp-chart" aria-label="Token flow by tool over the last 24 hours">
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
              height={220}
              yFormat={(v) => formatTokens(v)}
              xFormat={(t) =>
                new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", hour12: false })
              }
              ariaLabel="Token flow by tool over the last 24 hours"
            />
          )}
        </WidgetCard>
      </section>

      <section className="sp-grid-2" aria-label="Composition and cache">
        <WidgetCard title="Token mix this month" source="token totals · month to date" loading={loading}>
          <BarList
            items={composition}
            valueFormat={formatTokens}
            emptyLabel="No month-to-date data"
          />
        </WidgetCard>
        <WidgetCard
          title="Cache efficiency"
          source="token totals · month to date"
          loading={loading}
          footer={
            <>
              <span>target ≥ 70%</span>
              <span>warn &lt; 50%</span>
            </>
          }
        >
          <div className="sp-gauge-wrap">
            <Gauge
              value={tokens?.cacheReadRatio ?? 0}
              max={1}
              size={170}
              label="Cache reads / total tokens"
            />
          </div>
        </WidgetCard>
      </section>

      <section className="sp-chart" aria-label="Cache read efficiency · 7 day trend">
        <WidgetCard
          title="Cache read efficiency over 7 days"
          source="token totals · last 7 days"
          loading={cacheTrend.isPending}
          error={cacheTrend.error ? (cacheTrend.error as Error).message : null}
          footer={
            <>
              <span>0% — 100% scale</span>
              <span>hourly buckets</span>
            </>
          }
        >
          {cacheTrendSeries[0]?.points.length ? (
            <LineChart
              series={cacheTrendSeries}
              height={180}
              yFormat={(v) => `${Math.round(v * 100)}%`}
              xFormat={(t) =>
                new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
              ariaLabel="Cache-read efficiency hourly across 7 days"
              legend={false}
              yDomain={[0, 1]}
            />
          ) : (
            <EmptyState title="No cache-efficiency samples yet" />
          )}
        </WidgetCard>
      </section>

      <section className="sp-grid-2" aria-label="By source and by model">
        <WidgetCard title="Tokens by tool" source="token totals · month to date" loading={loading}>
          <BarList
            items={(tokens?.bySource ?? []).map((r) => ({
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
            items={(tokens?.byModel ?? []).map((r) => ({
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

      <section className="sp-agents" aria-label="By agent">
        <WidgetCard title="Tokens by agent" source="token totals · month to date" loading={loading}>
          <BarList
            items={(tokens?.byAgent ?? [])
              .slice()
              .sort((a, b) => b.tokens - a.tokens)
              .slice(0, 12)
              .map((r) => ({
                label: displaySourceLabel(r.agent),
                value: r.tokens,
                sub: `${formatCount(r.calls)} calls`,
              }))}
            valueFormat={formatTokens}
            color="var(--viz-dim)"
            emptyLabel="No agent token data"
          />
        </WidgetCard>
      </section>

      <section className="sp-chart" aria-label="Most expensive agent calls in the last 24 hours">
        <WidgetCard
          title="Most expensive agent calls in the last 24 hours"
          source="token totals · last 24 hours"
          loading={topCostly.isPending}
          error={topCostly.error ? (topCostly.error as Error).message : null}
          flush
        >
          <NativeTable<TopCostlyRow>
            columns={TOP_COSTLY_COLUMNS}
            rows={topCostlyRows}
            density="compact"
            maxHeight={420}
            emptyLabel="No agent calls in the last 24 hours"
            ariaLabel="Top 50 costly invocations in the last 24 hours"
          />
        </WidgetCard>
      </section>
    </>
  );
}
