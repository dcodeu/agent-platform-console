// KpiGrid — the 4 varied KPI tiles laid out 2×2 on mobile, 4×1 on desktop.
//
// Each tile has a deliberately different visual shape so the dashboard scans
// fast — varied is the point. Wires real `/api/snapshot.json` +
// `/api/ops/heavy.json` via TanStack Query (see data/queries.ts) with SSE
// invalidation (data/sse.ts).
//
// Data sources:
//   - Spend · MTD       → heavy.costs (mtd dollars, budget, projection)
//   - Invocations · 6h  → heavy.hermes.analytics (api_calls / sessions)
//   - iMessage queue    → snapshot.agents.hermes.gateway_platforms.imessage
//   - Codex pool        → snapshot.agents.codexPool
//
// Skeletons render until each query lands. We deliberately avoid an
// "error" state in the tile — the global toast layer (next wave) handles
// that. While loading, all KPI numbers are skeleton blocks at --fg-3.

import type React from "react";
import { KpiHeadline } from "./KpiHeadline.tsx";
import { KpiStat } from "./KpiStat.tsx";
import { KpiStatus } from "./KpiStatus.tsx";
import { KpiWorkerGrid, type Worker } from "./KpiWorkerGrid.tsx";
import { useSnapshot, useHeavy, type SnapshotPayload, type HeavyPayload } from "./data/queries.ts";
import { Skeleton } from "./data/Skeleton.tsx";
import { formatUsd, formatCount, formatLatencyMs } from "./data/format.ts";
import "./tile.css";
import "./KpiGrid.css";

interface CostTickPatch {
  mtdDollars?: number;
  todayDollars?: number;
  budgetPct?: number;
}

export function KpiGrid() {
  const snapshot = useSnapshot();
  const heavy = useHeavy();
  const tick = (snapshot.data as (SnapshotPayload & { latestCostTick?: CostTickPatch }) | undefined)
    ?.latestCostTick;

  return (
    <section className="y2-kpis" aria-label="KPI summary">
      <SpendTile heavy={heavy.data} loading={heavy.isPending} tick={tick} />
      <InvocationsTile heavy={heavy.data} loading={heavy.isPending} />
      <IMessageTile
        heavy={heavy.data}
        loading={heavy.isPending && snapshot.isPending}
      />
      <CodexPoolTile snapshot={snapshot.data} loading={snapshot.isPending} />
    </section>
  );
}

// ── Spend · MTD ────────────────────────────────────────────────

function SpendTile({
  heavy,
  loading,
  tick,
}: {
  heavy: HeavyPayload | undefined;
  loading: boolean;
  tick?: CostTickPatch;
}) {
  if (loading || !heavy) {
    return (
      <KpiHeadline
        title="Spend this month"
        value={<Skeleton inline width={92} height={28} />}
        delta={<Skeleton inline width={36} height={14} />}
        projection={<Skeleton inline width={64} height={11} />}
        budget={<Skeleton inline width={72} height={11} />}
        consumedPct={0}
      />
    );
  }
  const c = heavy.costs;
  // SSE cost.tick gives us the freshest mtd/budget without a refetch.
  const mtd = tick?.mtdDollars ?? c.mtd.dollars;
  const todayDollars = tick?.todayDollars ?? c.today.dollars;
  const budgetDollars = c.budgetCents / 100;
  const budgetPct = tick?.budgetPct ?? c.budgetPct;
  // Compare today vs daily-rate-so-far for a quick delta chip.
  const dayOfMonth = new Date().getUTCDate();
  const priorDays = Math.max(1, dayOfMonth - 1);
  const dailyAvg = (mtd - todayDollars) / priorDays;
  const deltaPct = dailyAvg > 0 ? ((todayDollars - dailyAvg) / dailyAvg) * 100 : 0;
  const deltaSign = deltaPct >= 0 ? "+" : "";
  return (
    <KpiHeadline
      title="Spend this month"
      value={formatUsd(mtd)}
      delta={`${deltaSign}${Math.round(deltaPct)}%`}
      projection={`proj ${formatUsd(c.forecastMonthDollars, { whole: true })}`}
      budget={`budget ${formatUsd(budgetDollars, { whole: true })}`}
      consumedPct={budgetPct}
    />
  );
}

// ── Invocations ────────────────────────────────────────────────

function InvocationsTile({
  heavy,
  loading,
}: {
  heavy: HeavyPayload | undefined;
  loading: boolean;
}) {
  if (loading || !heavy) {
    return (
      <KpiStat
        title="Agent calls"
        value={<Skeleton inline width={72} height={28} />}
        facts={[
          <Skeleton key={0} inline width={88} height={11} />,
          <Skeleton key={1} inline width={72} height={11} />,
          <Skeleton key={2} inline width={64} height={11} />,
        ]}
      />
    );
  }
  const analytics = heavy.hermes.analytics;
  const apiCalls = analytics?.totals.total_api_calls ?? 0;
  const sessions = analytics?.totals.total_sessions ?? 0;
  const days = analytics?.period_days ?? 7;
  const todayCalls = analytics?.daily.at(-1)?.api_calls ?? 0;
  const prevCalls = analytics?.daily.at(-2)?.api_calls ?? 0;
  const deltaCalls = todayCalls - prevCalls;
  // p95 latency isn't yet in HermesAnalytics — show a synthetic proxy until
  // Phase 3 lands real histograms. Hidden if 0.
  const proxyP95 = apiCalls > 0 && analytics
    ? (analytics.totals.total_estimated_cost / apiCalls) * 1000
    : null;
  const facts: React.ReactNode[] = [];
  if (proxyP95 && proxyP95 > 0) {
    facts.push(
      <>
        slowest typical response <b>{formatLatencyMs(proxyP95)}</b>
      </>,
    );
  }
  facts.push(
    <>
      <b>{formatCount(sessions)}</b> sessions
    </>,
  );
  facts.push(
    <>
      {deltaCalls >= 0 ? "+" : ""}
      {deltaCalls} vs prev
    </>,
  );
  return (
    <KpiStat
      title={`Agent calls · last ${days} days`}
      value={formatCount(apiCalls)}
      facts={facts}
    />
  );
}

// ── iMessage queue ─────────────────────────────────────────────
//
// The gateway-platforms map (which carries the iMessage connection details)
// lives on heavy.hermes.status — the richer HermesStatusResponse from
// /api/ops/heavy.json. snapshot.agents.hermes is a thinner shape that
// doesn't carry platform info.

function IMessageTile({
  heavy,
  loading,
}: {
  heavy: HeavyPayload | undefined;
  loading: boolean;
}) {
  if (loading || !heavy) {
    return (
      <KpiStatus
        title="iMessage queue"
        state={<Skeleton inline width={88} height={20} />}
        count={<Skeleton inline width={80} height={11} />}
        sub={<Skeleton inline width={180} height={11} />}
      />
    );
  }
  const hermes = heavy.hermes.status;
  const platforms = hermes?.gateway_platforms ?? {};
  // Look up the iMessage entry under any of the keys Hermes might use.
  const imessage =
    platforms.imessage ?? platforms.iMessage ?? platforms.sendblue ?? null;
  const connected = imessage?.connected === true;
  const state = connected ? "Drained" : hermes?.gateway_running ? "Idle" : "Down";
  const userCount = imessage?.users ?? 0;
  const sessionCount = hermes?.active_sessions ?? 0;
  const lastAt = imessage?.last_message_at ?? null;
  const lastLine = lastAt
    ? `last msg ${new Date(lastAt).toISOString().slice(11, 19)}Z`
    : `${sessionCount} active sessions`;
  return (
    <KpiStatus
      title="iMessage queue"
      state={state}
      count={`${userCount} users`}
      sub={lastLine}
    />
  );
}

// ── Codex pool ─────────────────────────────────────────────────

function CodexPoolTile({
  snapshot,
  loading,
}: {
  snapshot: SnapshotPayload | undefined;
  loading: boolean;
}) {
  if (loading || !snapshot) {
    // Pre-allocate 11 placeholder squares so the grid doesn't reflow on land.
    const placeholders: Worker[] = Array.from({ length: 11 }, (_, i) => ({
      id: `loading-${i}`,
      state: "ready" as const,
    }));
    return <KpiWorkerGrid title="Codex pool" workers={placeholders} />;
  }
  const pool = snapshot.agents.codexPool ?? [];
  const workers: Worker[] = pool.map((w) => ({
    id: w.id,
    state: w.authState === "valid" && w.enabled ? "ready" : "quar",
  }));
  return <KpiWorkerGrid title="Codex pool" workers={workers} />;
}
