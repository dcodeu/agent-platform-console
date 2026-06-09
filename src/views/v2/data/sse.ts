// sse.ts — SSE connector + React provider for the v2 console.
//
// Wire protocol (see /opt/agent-platform/apps/console/src/server.ts ~L283+):
//   alert.created     → { id, severity, kind, title, ... }   (Alert)
//   alert.resolved    → { id }
//   heartbeat         → { agentId, agentName, status, lastHeartbeatAt }
//   cost.tick         → { mtdDollars, todayDollars, budgetPct }
//
// Server endpoint is /api/stream (not /api/events — the task brief said
// "verify in server.ts" so we did). We also poll /api/build to catch a
// deployed bundle drift; if the build hash on the server changes from what
// we booted with, we reload the page once — matching the legacy app.js
// behavior at public/assets/app.js.
//
// Reconnect uses exponential backoff capped at 30s. Each connection that
// successfully sends a "hello" event resets the backoff timer.

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { queryClient } from "./queryClient.ts";
import { queryKeys, type SnapshotPayload } from "./queries.ts";

// ────────────────────────────────────────────────────────────
// Heartbeat store (tiny external store, no React state)
// ────────────────────────────────────────────────────────────

type HeartbeatListener = () => void;

let lastHeartbeatAt: number | null = null;
const heartbeatListeners = new Set<HeartbeatListener>();

function setHeartbeat(ts: number) {
  lastHeartbeatAt = ts;
  for (const fn of heartbeatListeners) fn();
}

export function useLastHeartbeat(): number | null {
  return useSyncExternalStore(
    (cb) => {
      heartbeatListeners.add(cb);
      return () => heartbeatListeners.delete(cb);
    },
    () => lastHeartbeatAt,
    () => null,
  );
}

// ────────────────────────────────────────────────────────────
// EventSource lifecycle
// ────────────────────────────────────────────────────────────

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BUILD_POLL_MS = 60_000;

let connection: {
  es: EventSource;
  attempt: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
} | null = null;
let buildPollTimer: ReturnType<typeof setInterval> | null = null;
let knownBuild: string | null = null;
let providerCount = 0;

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function handleAlertCreated() {
  queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
}

function handleAlertResolved() {
  queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
}

function handleApprovalEvent() {
  queryClient.invalidateQueries({ queryKey: queryKeys.approvalsPending });
  // approvalsAll is keyed by [..., limit] so invalidate the prefix.
  queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll });
  // The ApprovalBanner reads heavy.approvalsPending for Paperclip approvals
  // and refreshes through the same heavy cache; invalidate that too so the
  // banner re-evaluates even when the row originated in our new system.
  queryClient.invalidateQueries({ queryKey: queryKeys.heavy });
}

function handleHeartbeat() {
  setHeartbeat(Date.now());
  // Heartbeat events also imply the heavy snapshot moved.
  queryClient.invalidateQueries({ queryKey: queryKeys.heavy });
}

interface CostTick {
  mtdDollars: number;
  todayDollars: number;
  budgetPct: number;
}

function handleCostTick(tick: CostTick) {
  // Optimistic merge into the snapshot cache so KPI tiles re-render
  // instantly. The next /api/snapshot.json refresh will reconcile.
  queryClient.setQueryData<SnapshotPayload | undefined>(
    queryKeys.snapshot,
    (prev) => {
      if (!prev) return prev;
      // Snapshot doesn't itself hold costs (heavy does), but we expose the
      // tick via a side-channel field so KpiHeadline can pick the freshest
      // dollar figure even when /api/ops/heavy.json hasn't been refetched.
      type SnapshotWithCost = SnapshotPayload & { latestCostTick?: CostTick };
      const next: SnapshotWithCost = { ...(prev as SnapshotWithCost), latestCostTick: tick };
      return next;
    },
  );
  // Also nudge the heavy query — the server already updated its cache, but
  // the client cache won't know until we ask. Use invalidate (not refetch)
  // so we only hit the network if a consumer is mounted.
  queryClient.invalidateQueries({ queryKey: queryKeys.heavy });
}

function scheduleReconnect() {
  if (!connection) return;
  const backoff = Math.min(
    MAX_BACKOFF_MS,
    MIN_BACKOFF_MS * 2 ** Math.max(0, connection.attempt - 1),
  );
  connection.reconnectTimer = setTimeout(() => {
    open();
  }, backoff);
}

function open() {
  // Close any prior connection without triggering another reconnect cycle.
  if (connection?.es) {
    try {
      connection.es.close();
    } catch {
      /* ignore */
    }
  }

  const es = new EventSource("/api/stream", { withCredentials: true });
  const attempt = (connection?.attempt ?? 0) + 1;
  connection = { es, attempt };

  es.addEventListener("hello", () => {
    if (connection) connection.attempt = 0;
  });

  es.addEventListener("alert.created", handleAlertCreated);
  es.addEventListener("alert.resolved", handleAlertResolved);

  es.addEventListener("approval.created", () => handleApprovalEvent());
  es.addEventListener("approval.decided", () => handleApprovalEvent());

  es.addEventListener("heartbeat", (evt) => {
    void evt; // payload not needed to refresh the cache
    handleHeartbeat();
  });

  es.addEventListener("cost.tick", (evt) => {
    const msg = evt as MessageEvent<string>;
    const tick = parseJson<CostTick>(msg.data);
    if (tick) handleCostTick(tick);
  });

  es.onerror = () => {
    // EventSource will auto-retry on its own at the server-suggested
    // `retry:` interval, but we layer our own exponential backoff for
    // belt-and-braces and to log/instrument failures.
    try {
      es.close();
    } catch {
      /* ignore */
    }
    scheduleReconnect();
  };
}

function close() {
  if (!connection) return;
  if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
  try {
    connection.es.close();
  } catch {
    /* ignore */
  }
  connection = null;
}

// ────────────────────────────────────────────────────────────
// Build-drift detection (mirrors legacy public/assets/app.js)
// ────────────────────────────────────────────────────────────

async function pollBuild() {
  try {
    const res = await fetch("/api/build", { cache: "no-store" });
    if (!res.ok) return;
    const info = (await res.json()) as { build?: string };
    if (!info.build) return;
    if (knownBuild === null) {
      knownBuild = info.build;
      return;
    }
    if (info.build !== knownBuild) {
      console.log("[v2] build drift detected, reloading", {
        have: knownBuild,
        server: info.build,
      });
      window.location.reload();
    }
  } catch {
    /* ignore — network blip */
  }
}

// ────────────────────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────────────────────

export interface SseProviderProps {
  children?: ReactNode;
}

/**
 * Opens the SSE connection on first mount, closes it when the last consumer
 * unmounts. Strict-Mode-safe: providerCount guards double-open/close in dev.
 */
export function SseProvider({ children }: SseProviderProps) {
  useEffect(() => {
    providerCount += 1;
    if (providerCount === 1) {
      open();
      pollBuild();
      buildPollTimer = setInterval(pollBuild, BUILD_POLL_MS);
    }
    return () => {
      providerCount = Math.max(0, providerCount - 1);
      if (providerCount === 0) {
        close();
        if (buildPollTimer) {
          clearInterval(buildPollTimer);
          buildPollTimer = null;
        }
      }
    };
  }, []);

  return children as ReactNode;
}
