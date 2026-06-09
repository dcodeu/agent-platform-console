// ServerTab — fully native host + container view.
//
// Pulls live Prometheus range queries for CPU, memory, and root disk usage;
// snapshot for current host pulse/uptime, snapshot.docker for containers, and
// Postgres queries for db cache hit ratio + active connections + deadlocks.

import { useMemo } from "react";

import { useHeavy, useSnapshot } from "../data/queries.ts";
import { useRangeContext } from "../data/RangeContext.tsx";
import { usePromInstant, usePromQuery, usePgQuery } from "../widgets/useNativeData.ts";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { NativeStat } from "../widgets/NativeStat.tsx";
import { LineChart } from "../widgets/LineChart.tsx";
import { StatusPill, type PillState } from "../widgets/StatusPill.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";

import { formatCount, formatPercent, formatRelativeTime } from "../data/format.ts";
import { containerPillState, friendlyContainerName, friendlyContainerState } from "./server-container-display.ts";
import {
  KUMA_TOTAL_PROMQL,
  KUMA_UP_PROMQL,
  formatKumaMonitorSub,
  formatKumaMonitorValue,
  kumaDownCount,
} from "./server-kuma-counts.ts";
import "./ServerTab.css";

function formatUptime(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days >= 1) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function pct(used: number, total: number): number | null {
  if (!total) return null;
  const p = (used / total) * 100;
  return Number.isFinite(p) ? p : null;
}

function toN(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function MetricTitle({ label, help }: { label: string; help: string }) {
  return (
    <span className="sv-metric-title" title={help} aria-label={`${label}: ${help}`}>
      {label}
      <span className="sv-metric-help" aria-hidden="true">?</span>
    </span>
  );
}

export function ServerTab() {
  const snapshot = useSnapshot();
  const heavy = useHeavy();
  const local = snapshot.data?.local;
  const docker = snapshot.data?.docker ?? [];
  const upstream = heavy.data?.upstream ?? [];

  const cpu = local?.cpuPct ?? null;
  const diskPct = local ? pct(local.diskRootUsedBytes, local.diskRootTotalBytes) : null;
  const uptime = local?.uptimeSeconds;

  // ── Global range → prom window ───────────────────────────────────
  const { def: rangeDef, window: rangeWindow } = useRangeContext();
  const rangeLabel = rangeDef.label; // e.g. "Last 6h"
  const promOpts = {
    refetchMs: 30_000,
    step: rangeWindow.stepSec,
    start: rangeWindow.startSec,
    end: rangeWindow.endSec,
  };

  // ── Prom CPU time series ─────────────────────────────────────────
  const cpuRange = usePromQuery(
    `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)`,
    promOpts,
  );

  // ── Prom Memory series ────────────────────────────────────────────
  const memRange = usePromQuery(
    `100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)`,
    promOpts,
  );

  // ── Prom root disk series ─────────────────────────────────────────
  const diskRange = usePromQuery(
    `100 * (1 - (sum(node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay|squashfs|ramfs"}) / sum(node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay|squashfs|ramfs"})))`,
    promOpts,
  );

  // ── Postgres health queries ──────────────────────────────────────
  const pgCache = usePgQuery(
    "SELECT round(sum(blks_hit)::numeric / NULLIF(sum(blks_hit) + sum(blks_read), 0), 4) AS ratio FROM pg_stat_database",
    { refetchMs: 60_000 },
  );
  const pgConn = usePgQuery(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active'",
    { refetchMs: 30_000 },
  );
  const pgDeadlocks = usePgQuery(
    "SELECT sum(deadlocks)::int AS n FROM pg_stat_database",
    { refetchMs: 60_000 },
  );

  const cacheRatio = toN(pgCache.data?.rows[0]?.[0]);
  const conns = toN(pgConn.data?.rows[0]?.[0]);
  const deadlocks = toN(pgDeadlocks.data?.rows[0]?.[0]);

  // ── Kuma monitor counts ──────────────────────────────────────────
  // Query the Kuma Prometheus exporter directly. heavy.upstream is only the
  // small parent/check bucket list, so using it here regresses to "6 of 6".
  const kumaTotalQ = usePromInstant(KUMA_TOTAL_PROMQL, { refetchMs: 30_000 });
  const kumaUpQ = usePromInstant(KUMA_UP_PROMQL, { refetchMs: 30_000 });
  const kumaTotal = kumaTotalQ.data?.[0]?.value ?? null;
  const kumaUp = kumaUpQ.data?.[0]?.value ?? null;
  const kumaDown = kumaDownCount(kumaTotal, kumaUp);

  // ── Upstream-probe down list ─────────────────────────────────────
  const upstreamDown = upstream.filter((u) => !u.ok);

  const cpuChart = useMemo(() => {
    const points = (cpuRange.data?.[0]?.values ?? []) as Array<[number, number]>;
    return [{ name: "cpu %", color: "var(--accent)", points }];
  }, [cpuRange.data]);

  const memChart = useMemo(() => {
    const points = (memRange.data?.[0]?.values ?? []) as Array<[number, number]>;
    return [{ name: "memory used %", color: "var(--attn)", points }];
  }, [memRange.data]);

  const diskChart = useMemo(() => {
    const points = (diskRange.data?.[0]?.values ?? []) as Array<[number, number]>;
    return [{ name: "root disk used %", color: "var(--viz-dim)", points }];
  }, [diskRange.data]);

  const fmtHour = (n: number) =>
    new Date(n).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <>
      <section className="sv-pulse" aria-label="Server pulse">
        {/* Current host pulse: CPU/load, disk capacity, and uptime stay here because
            they answer "what is the machine doing now?" without duplicating the
            range charts below. Memory is intentionally chart-only below. */}
        <WidgetCard title="Processor use" source="live server snapshot" loading={snapshot.isPending}>
          <div className="sv-pulse-n">{cpu != null ? `${cpu.toFixed(0)}%` : "—"}</div>
          <div className="sv-pulse-sub">
            {local?.cores ?? "—"} cores · load {local?.loadAvg.map((n) => n.toFixed(2)).join(" / ") ?? "—"}
          </div>
        </WidgetCard>
        <NativeStat
          title="Main disk used"
          value={diskPct != null ? `${diskPct.toFixed(0)}%` : "—"}
          source="live server snapshot"
          sub={
            local
              ? `${(local.diskRootUsedBytes / 1e9).toFixed(0)}G / ${(local.diskRootTotalBytes / 1e9).toFixed(0)}G`
              : "—"
          }
          loading={snapshot.isPending}
        />
        <NativeStat
          title="Uptime"
          value={formatUptime(uptime)}
          source="live server snapshot"
          sub={local?.hostname ?? "—"}
          loading={snapshot.isPending}
        />
      </section>

      <section className="sv-charts" aria-label="CPU, memory, and disk usage">
        {/* Range charts: exactly one CPU graph, one memory graph with percent axis,
            and one disk graph so trend widgets match the resources operators scan. */}
        <WidgetCard title={`Processor use · ${rangeLabel.toLowerCase()}`} source={`server metrics · ${rangeDef.label.toLowerCase()}`} loading={cpuRange.isPending}>
          {cpuChart[0].points.length === 0 ? (
            <EmptyState title="No CPU samples" />
          ) : (
            <LineChart
              series={cpuChart}
              height={200}
              yFormat={(v) => `${v.toFixed(0)}%`}
              xFormat={fmtHour}
              yDomain={[0, 100]}
              ariaLabel="CPU percent over time"
            />
          )}
        </WidgetCard>
        <WidgetCard title={`Memory used · ${rangeLabel.toLowerCase()}`} source={`server metrics · ${rangeDef.label.toLowerCase()}`} loading={memRange.isPending}>
          {memChart[0].points.length === 0 ? (
            <EmptyState title="No memory samples" />
          ) : (
            <LineChart
              series={memChart}
              height={200}
              yFormat={(v) => `${v.toFixed(0)}%`}
              xFormat={fmtHour}
              yDomain={[0, 100]}
              ariaLabel="Memory percent over time"
            />
          )}
        </WidgetCard>
        <WidgetCard title={`Main disk used · ${rangeLabel.toLowerCase()}`} source={`server metrics · ${rangeDef.label.toLowerCase()}`} loading={diskRange.isPending}>
          {diskChart[0].points.length === 0 ? (
            <EmptyState title="No disk samples" />
          ) : (
            <LineChart
              series={diskChart}
              height={200}
              yFormat={(v) => `${v.toFixed(0)}%`}
              xFormat={fmtHour}
              yDomain={[0, 100]}
              ariaLabel="Root disk percent used over time"
            />
          )}
        </WidgetCard>
      </section>

      <section className="sv-pg" aria-label="Database health">
        <NativeStat
          title={
            <MetricTitle
              label="DB reads from memory"
              help="How often database reads are served from memory instead of slower disk. Higher is better."
            />
          }
          value={cacheRatio != null ? formatPercent(cacheRatio) : "—"}
          source="database metrics · live now"
          sub={
            cacheRatio != null && cacheRatio < 0.95
              ? "Low: more reads are hitting disk"
              : "Percent of DB reads served from RAM"
          }
          loading={pgCache.isPending}
        />
        <NativeStat
          title={
            <MetricTitle
              label="Queries running now"
              help="Active database connections: connections currently executing a query, not idle clients waiting around."
            />
          }
          value={conns != null ? formatCount(conns) : "—"}
          source="database metrics · live now"
          sub="Connections currently doing DB work"
          loading={pgConn.isPending}
        />
        <NativeStat
          title={
            <MetricTitle
              label="Database write stalemates"
              help="Total times two database writes blocked each other until one was cancelled."
            />
          }
          value={deadlocks != null ? formatCount(deadlocks) : "—"}
          source="database metrics · live now"
          sub="Total cancelled stalemates between writes"
          loading={pgDeadlocks.isPending}
        />
        <NativeStat
          title="Website and service checks"
          value={formatKumaMonitorValue(kumaUp, kumaTotal)}
          source="monitor checks · live now"
          sub={formatKumaMonitorSub(kumaDown)}
          loading={kumaUpQ.isPending || kumaTotalQ.isPending}
        />
      </section>

      <section aria-label="Containers">
        <WidgetCard title="Containers" source={`container status · ${docker.length}`} loading={snapshot.isPending} flush>
          {docker.length === 0 ? (
            <EmptyState title="No containers reported" />
          ) : (
            <table className="sv-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>State</th>
                  <th>Container</th>
                </tr>
              </thead>
              <tbody>
                {docker.map((c) => {
                  const state = containerPillState(c.status) satisfies PillState;
                  return (
                    <tr key={c.name}>
                      <td>{friendlyContainerName(c)}</td>
                      <td><StatusPill state={state} label={friendlyContainerState(c.status)} /></td>
                      <td className="sv-table-dim">{c.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </WidgetCard>
      </section>

      {upstreamDown.length > 0 ? (
        <section aria-label="Upstream down">
          <WidgetCard title="Monitors down" source="monitor checks · live now" loading={false}>
            <ul className="sv-monitors">
              {upstreamDown.map((u) => (
                <li key={u.name}>
                  <span className="sv-monitor-name">{u.name}</span>
                  <StatusPill state="alert" label="down" />
                  <span className="sv-monitor-sub">
                    {u.consecutiveFailures} fail · last ok {formatRelativeTime(u.lastOkAt ?? null)}
                  </span>
                </li>
              ))}
            </ul>
          </WidgetCard>
        </section>
      ) : null}
    </>
  );
}
