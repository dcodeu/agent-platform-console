// tab-registry — single source of truth for the subnav tabs.
//
// Adding a tab here is one half of the change; the other half is wiring up
// the matching component in main.tsx TAB_COMPONENTS map. Both stay in
// lockstep via the TabKey union.

import type { IconName } from "../icon-sprite.tsx";

export type TabKey =
  | "overview"
  | "noc"
  | "apm"
  | "logs"
  | "spend"
  | "agents"
  | "imessage"
  | "server"
  | "approvals";

export interface TabDef {
  key: TabKey;
  label: string;
  icon: IconName;
}

export const TABS: readonly TabDef[] = [
  { key: "overview", label: "Overview", icon: "layout-dashboard" },
  { key: "noc", label: "NOC", icon: "radio" },
  { key: "apm", label: "App health", icon: "trending-up" },
  { key: "logs", label: "Logs", icon: "more-horizontal" },
  { key: "spend", label: "Spend", icon: "dollar-sign" },
  { key: "agents", label: "Agents", icon: "activity" },
  { key: "imessage", label: "iMessage", icon: "message-circle" },
  { key: "server", label: "Server", icon: "layout-dashboard" },
  { key: "approvals", label: "Approvals", icon: "flag" },
] as const;

export const DEFAULT_TAB: TabKey = "overview";

const VALID_KEYS = new Set<TabKey>(TABS.map((t) => t.key));

export function isTabKey(value: string): value is TabKey {
  return VALID_KEYS.has(value as TabKey);
}
