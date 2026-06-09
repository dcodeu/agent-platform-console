// AgentsTab — TOKEN-ONLY agent view.
//
// Full Codex pool grid + token-by-agent breakdowns + roster + activity feed
// + worker fairness (LRU heat) chip. No dollars anywhere on this tab.

import { useMemo, useState } from "react";

import { useHeavy, useSnapshot } from "../data/queries.ts";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { NativeStat } from "../widgets/NativeStat.tsx";
import { BarList } from "../widgets/BarList.tsx";
import { LineChart } from "../widgets/LineChart.tsx";
import { StatusPill } from "../widgets/StatusPill.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";
import { KpiWorkerGrid, type Worker } from "../KpiWorkerGrid.tsx";
import { CodexWorkerDrawer } from "../CodexWorkerDrawer.tsx";
import type { CodexWorker } from "../../../lib/workers.ts";
import { formatCount, formatRelativeTime, formatTokens } from "../data/format.ts";
import { displaySourceLabel, displayStatusLabel } from "../data/display.ts";
import "./AgentsTab.css";

type AgentStateFilter = "all" | "ok" | "idle" | "alert";

export function AgentsTab() {
  const snapshot = useSnapshot();
  const heavy = useHeavy();
  const loading = heavy.isPending || snapshot.isPending;

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<AgentStateFilter>("all");
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  const pool = snapshot.data?.agents.codexPool ?? [];
  const selectedWorker: CodexWorker | null = useMemo(
    () => (selectedWorkerId ? pool.find((w) => w.id === selectedWorkerId) ?? null : null),
    [pool, selectedWorkerId],
  );
  const rosterRaw = heavy.data?.agentRoster ?? [];
  const activityRaw = heavy.data?.activityFeed ?? [];
  const byAgentRaw = heavy.data?.tokens.byAgent ?? [];

  // Apply search to roster/activity/by-agent tables consistently.
  const q = search.trim().toLowerCase();
  const roster = useMemo(() => {
    return rosterRaw.filter((a) => {
      if (q.length > 0 && !a.name.toLowerCase().includes(q) && !(a.role ?? "").toLowerCase().includes(q)) {
        return false;
      }
      if (stateFilter === "all") return true;
      const st = a.stuck ? "alert" : (a.status === "running" || a.status === "active" ? "ok" : "idle");
      return st === stateFilter;
    });
  }, [rosterRaw, q, stateFilter]);

  const activity = useMemo(() => {
    if (q.length === 0) return activityRaw;
    return activityRaw.filter((a) => a.agentName.toLowerCase().includes(q));
  }, [activityRaw, q]);

  const byAgent = useMemo(() => {
    if (q.length === 0) return byAgentRaw;
    return byAgentRaw.filter((r) => r.agent.toLowerCase().includes(q));
  }, [byAgentRaw, q]);

  const workers: Worker[] = pool.length
    ? pool.map((w) => ({
        id: w.id,
        state: w.authState === "valid" && w.enabled ? "ready" : "quar",
      }))
    : Array.from({ length: 11 }, (_, i) => ({
        id: `codex-${String(i + 1).padStart(2, "0")}`,
        state: "ready" as const,
      }));

  const readyCount = workers.filter((w) => w.state === "ready").length;

  // Heartbeats last hour count (use activity feed where lastHeartbeatAt < 1h)
  const heartbeatsLastHour = useMemo(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    return activity.filter((a) => {
      const t = a.lastHeartbeatAt ? Date.parse(a.lastHeartbeatAt) : 0;
      return t >= cutoff;
    }).length;
  }, [activity]);

  // Worker fairness — sort by lastUsedAt asc (cold) — desc (hot)
  const workerHeat = useMemo(() => {
    return pool
      .slice()
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
      .map((w, i, arr) => ({
        label: w.id,
        value: w.lastUsedAt ?? 0,
        sub: i === 0 ? "hottest" : i === arr.length - 1 ? "coldest" : formatRelativeTime(w.lastUsedAt ?? null),
      }));
  }, [pool]);

  // Daily series for top 5 agents (synthesize from MTD totals — daily breakdown
  // by agent isn't in heavy.tokens.daily today, so we render a single-point
  // series until daily-by-agent lands).
  // For now we provide a simple top-5 bars instead of a multi-line chart.
  const topAgents = useMemo(() => {
    return byAgent
      .slice()
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5);
  }, [byAgent]);

  // Build a per-agent "today vs MTD" mini comparison chart series. Since we
  // only have aggregate by-agent (no per-day), render 2 buckets: today total
  // (proportional) vs MTD. This is best-effort visual.
  const fairnessChart = useMemo(() => {
    // Show pool LRU as a single-line chart sorted by lastUsedAt.
    const now = Date.now();
    const points: Array<[number, number]> = workerHeat.map((w, i) => [now + i * 1000, w.value]);
    return [{ name: "lastUsedAt", color: "var(--accent)", points }];
  }, [workerHeat]);

  return (
    <>
      <section className="ag-filters" aria-label="Agent filters">
        <input
          type="search"
          placeholder="Search agent name or role…"
          className="ag-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search agents"
        />
        <div className="ag-fgrp" role="group" aria-label="State">
          <span className="ag-flbl">State</span>
          <div className="ag-pills">
            {(["all", "ok", "idle", "alert"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`ag-pill${s === stateFilter ? " is-on" : ""}`}
                onClick={() => setStateFilter(s)}
              >
                {displayStatusLabel(s)}
              </button>
            ))}
          </div>
        </div>
        <span className="ag-count">
          {roster.length}/{rosterRaw.length} agents
        </span>
      </section>

      <section className="ag-pulse" aria-label="Pool pulse">
        <KpiWorkerGrid
          title="Codex pool"
          workers={workers}
          onSelect={(id) => setSelectedWorkerId(id)}
        />
        <NativeStat
          title="Agents · registered"
          value={formatCount(roster.length)}
          source="PAPERCLIP · LIVE"
          sub={`${readyCount} codex ready`}
          loading={loading}
        />
        <NativeStat
          title="Heartbeats · 1h"
          value={formatCount(heartbeatsLastHour)}
          source="ACTIVITY FEED"
          sub={`${activity.length} feed entries`}
          loading={loading}
        />
      </section>

      <section className="ag-flow" aria-label="Tokens by agent">
        <WidgetCard title="Tokens by agent (top 12)" source="Agent activity · month to date" loading={loading}>
          <BarList
            items={byAgent
              .slice()
              .sort((a, b) => b.tokens - a.tokens)
              .slice(0, 12)
              .map((r) => ({
                label: displaySourceLabel(r.agent),
                value: r.tokens,
                sub: `${formatCount(r.calls)} calls`,
              }))}
            valueFormat={formatTokens}
            emptyLabel="No per-agent token data"
          />
        </WidgetCard>
        <WidgetCard title="Top 5 totals" source="Agent activity · month to date" loading={loading}>
          {topAgents.length === 0 ? (
            <EmptyState title="No agent activity" />
          ) : (
            <BarList
              items={topAgents.map((a) => ({
                label: displaySourceLabel(a.agent),
                value: a.tokens,
                sub: `${formatCount(a.calls)} calls`,
              }))}
              valueFormat={formatTokens}
              color="var(--attn)"
            />
          )}
        </WidgetCard>
      </section>

      <section aria-label="Worker fairness">
        <WidgetCard title="Worker fairness" source="worker pool snapshot" loading={loading}>
          {workerHeat.length === 0 ? (
            <EmptyState title="Codex pool not reported" />
          ) : (
            <>
              <LineChart
                series={fairnessChart}
                height={120}
                yFormat={(v) => (v > 0 ? new Date(v).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—")}
                xFormat={() => ""}
                grid={false}
                legend={false}
                ariaLabel="Worker LRU heat"
              />
              <div className="ag-fair-strip">
                {workerHeat.map((w, i) => (
                  <span key={w.label} className={`ag-fair-i${i === 0 ? " is-hot" : i === workerHeat.length - 1 ? " is-cold" : ""}`}>
                    <b>{w.label}</b>
                    <span>{w.sub}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </WidgetCard>
      </section>

      <section aria-label="Agent roster">
        <WidgetCard title="Agent roster" source="PAPERCLIP · LIVE" loading={loading} flush>
          {roster.length === 0 ? (
            <EmptyState title="No agents registered yet" />
          ) : (
            <table className="ag-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>State</th>
                  <th>Last seen</th>
                  <th>Role</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((a) => {
                  const state =
                    a.stuck ? "alert" :
                    a.status === "running" || a.status === "active" ? "ok" : "idle";
                  return (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td><StatusPill state={state} label={displayStatusLabel(a.status)} /></td>
                      <td className="ag-table-dim">{formatRelativeTime(a.lastHeartbeatAt)}</td>
                      <td className="ag-table-dim">{a.role}</td>
                      <td className="ag-table-dim">{a.model ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </WidgetCard>
      </section>

      <section aria-label="Recent activity">
        <WidgetCard title="Recent activity" source="HEARTBEATS · 20" loading={loading} flush>
          {activity.length === 0 ? (
            <EmptyState title="No recent heartbeats" />
          ) : (
            <ul className="ag-activity">
              {activity.slice(0, 20).map((a) => (
                <li key={a.id}>
                  <span className="ag-activity-name">{a.agentName}</span>
                  <span className="ag-activity-status">{a.status}</span>
                  <span className="ag-activity-ts">{formatRelativeTime(a.lastHeartbeatAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </WidgetCard>
      </section>

      <CodexWorkerDrawer
        worker={selectedWorker}
        onClose={() => setSelectedWorkerId(null)}
      />
    </>
  );
}
