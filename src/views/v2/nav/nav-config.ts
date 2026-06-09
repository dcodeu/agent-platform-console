// nav-config — single source of truth for the consolidated primary nav.
//
// Replaces the old dual scheme (PRODUCT_NAV in AppShell + TABS in the
// always-on subnav). The IA collapses to 5 primary categories — each is
// either a direct link (one sub) or a dropdown (multiple subs). Tabs
// themselves remain unchanged (`#overview`, `#apm`, ...); categories are
// pure UI grouping with no URL representation.

import type { IconName } from "../icon-sprite.tsx";
import type { TabKey } from "../tabs/tab-registry.ts";

export type CategoryKey =
  | "cockpit"
  | "observability"
  | "tokens"
  | "channels"
  | "approvals";

export interface NavSubItem {
  tab: TabKey;
  label: string;
  icon?: IconName;
}

export interface NavCategory {
  key: CategoryKey;
  label: string;
  icon?: IconName;
  subs: readonly NavSubItem[];
}

/** Primary-nav categories. Each renders as a topbar item; one sub becomes a
 *  direct link, many subs become a dropdown menu of tab siblings. */
export const NAV: readonly NavCategory[] = [
  {
    key: "cockpit",
    label: "Cockpit",
    icon: "layout-dashboard",
    subs: [
      { tab: "overview", label: "Overview", icon: "layout-dashboard" },
      { tab: "noc", label: "NOC", icon: "radio" },
    ],
  },
  {
    key: "observability",
    label: "Observability",
    icon: "activity",
    subs: [
      { tab: "apm", label: "App health", icon: "trending-up" },
      { tab: "logs", label: "Logs", icon: "more-horizontal" },
      { tab: "server", label: "Server", icon: "layout-dashboard" },
    ],
  },
  {
    key: "tokens",
    label: "Tokens",
    icon: "dollar-sign",
    subs: [
      { tab: "spend", label: "Spend", icon: "dollar-sign" },
      { tab: "agents", label: "Agents", icon: "activity" },
    ],
  },
  {
    key: "channels",
    label: "Channels",
    icon: "message-circle",
    subs: [
      { tab: "imessage", label: "iMessage", icon: "message-circle" },
    ],
  },
  {
    key: "approvals",
    label: "Approvals",
    icon: "flag",
    subs: [{ tab: "approvals", label: "Approvals", icon: "flag" }],
  },
] as const;

/**
 * Legacy event item (kept for back-compat with PrimaryNav, which still
 * dispatches `open-approvals` for code that listens). The Approvals tab now
 * lives in NAV proper so navigation routes through the normal direct-link
 * flow. The event is now harmless but still useful for the CommandPalette
 * to surface "Open approvals" without knowing the tab key.
 */
export interface NavEventItem {
  key: "approvals";
  label: string;
  icon: IconName;
  event: string;
}

export const APPROVALS_NAV: NavEventItem = {
  key: "approvals",
  label: "Approvals",
  icon: "flag",
  event: "open-approvals",
};

/** Look up the category that owns a given tab. Returns null if the tab is
 *  not part of any registered category (shouldn't happen given the registry). */
export function categoryForTab(tab: TabKey): NavCategory | null {
  for (const cat of NAV) {
    if (cat.subs.some((s) => s.tab === tab)) return cat;
  }
  return null;
}

/** First sub of a category — used by BottomNav and mobile sheet routing. */
export function firstTabOf(category: NavCategory): TabKey {
  return category.subs[0].tab;
}
