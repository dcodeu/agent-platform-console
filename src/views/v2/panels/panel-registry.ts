// panel-registry — typed map of logical panel keys → Grafana coordinates.
//
// UIDs and panelIds were verified against the provisioned dashboard JSON at
// /opt/agent-platform/apps/observability/grafana/provisioning/dashboards/ on
// 2026-05-21. Adjust here, not in callers.

import type { PanelVariant } from "./IframePanel.tsx";

export interface PanelDef {
  uid: string;
  panelId: number;
  variant: PanelVariant;
  defaultTitle: string;
}

export const PANELS = {
  // ── ai-invocations-v2 ───────────────────────────────────────────────
  costMtd: {
    uid: "ai-invocations-v2",
    panelId: 2,
    variant: "stat",
    defaultTitle: "Cost · 24h",
  },
  successRate24h: {
    uid: "ai-invocations-v2",
    panelId: 6,
    variant: "stat",
    defaultTitle: "Success rate · 24h",
  },
  invocationsByHour: {
    uid: "ai-invocations-v2",
    panelId: 7,
    variant: "bar",
    defaultTitle: "Hourly agent calls by tool",
  },
  latencyP95: {
    uid: "ai-invocations-v2",
    panelId: 9,
    variant: "timeseries",
    defaultTitle: "Latency · p50/p95/p99",
  },

  // ── cost-and-spend ─────────────────────────────────────────────────
  spend30d: {
    uid: "cost-and-spend",
    panelId: 1,
    variant: "stat",
    defaultTitle: "Spend · 30d",
  },
  spendActualVsShadow: {
    uid: "cost-and-spend",
    panelId: 7,
    variant: "timeseries",
    defaultTitle: "Spend · actual vs shadow",
  },

  // ── imessage-pipeline ──────────────────────────────────────────────
  imessageSendRatio: {
    uid: "imessage-pipeline",
    panelId: 6,
    variant: "stat",
    defaultTitle: "iMessage · send success",
  },
  imessageSendRate: {
    uid: "imessage-pipeline",
    panelId: 7,
    variant: "timeseries",
    defaultTitle: "iMessage · send rate",
  },

  // ── host-and-containers ────────────────────────────────────────────
  hostCpu: {
    uid: "host-and-containers",
    panelId: 1,
    variant: "stat",
    defaultTitle: "Host · CPU",
  },
  cpuByMode: {
    uid: "host-and-containers",
    panelId: 5,
    variant: "timeseries",
    defaultTitle: "CPU · by mode",
  },

  // ── postgres-health ────────────────────────────────────────────────
  pgCacheHit: {
    uid: "postgres-health",
    panelId: 4,
    variant: "stat",
    defaultTitle: "Postgres · cache hit",
  },

  // ── logs-explorer ──────────────────────────────────────────────────
  logsLinesPerSec: {
    uid: "logs-explorer",
    panelId: 1,
    variant: "stat",
    defaultTitle: "Logs · lines/sec",
  },

  // ── uptime-kuma ────────────────────────────────────────────────────
  kumaUp: {
    uid: "uptime-kuma",
    panelId: 1,
    variant: "stat",
    defaultTitle: "Kuma · monitors up",
  },

  // ── cloudflare-edge ────────────────────────────────────────────────
  cfWorkerRequests: {
    uid: "cloudflare-edge",
    panelId: 7,
    variant: "timeseries",
    defaultTitle: "CF · worker requests",
  },

  // ── tokens (wall) ──────────────────────────────────────────────────
  // Standalone wall tiles — no Grafana dashboard backing them. We register
  // them here so ZoomShell type-checks against PanelKey when alerts arrive.
  tokens24h: {
    uid: "wall-tokens",
    panelId: 1,
    variant: "stat",
    defaultTitle: "Tokens · 24h",
  },
  activeSessions: {
    uid: "wall-sessions",
    panelId: 1,
    variant: "stat",
    defaultTitle: "Sessions · active",
  },
} as const satisfies Record<string, PanelDef>;

export type PanelKey = keyof typeof PANELS;

export function getPanel(key: PanelKey): PanelDef {
  return PANELS[key];
}
