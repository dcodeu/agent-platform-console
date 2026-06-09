// use-tab-router — hash-based routing for the v2 subnav.
//
// Hash is the only source of truth (e.g. `#spend`). On mount we read it;
// when the user clicks a subnav, we push to the hash via history.pushState
// (no reload) and fire a synthetic popstate so listeners pick it up. We also
// react to native popstate + hashchange so the back/forward buttons work.

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_TAB, isTabKey, type TabKey } from "./tab-registry.ts";

function readTabFromHash(): TabKey {
  if (typeof window === "undefined") return DEFAULT_TAB;
  // Hash may carry an embedded query, e.g. "#spend?range=7d" — strip the
  // query portion before matching the tab key.
  const raw = window.location.hash.replace(/^#/, "").split("?")[0].trim().toLowerCase();
  if (!raw) return DEFAULT_TAB;
  return isTabKey(raw) ? raw : DEFAULT_TAB;
}

export interface TabRouter {
  tab: TabKey;
  setTab: (next: TabKey) => void;
}

export function useTabRouter(): TabRouter {
  const [tab, setTabState] = useState<TabKey>(() => readTabFromHash());

  useEffect(() => {
    const sync = () => setTabState(readTabFromHash());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    // Initial sync in case the hash changed between hook mount and event wire.
    sync();
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const setTab = useCallback((next: TabKey) => {
    if (!isTabKey(next)) return;
    // Preserve any embedded query string (e.g. "?range=7d") so the active
    // range survives tab navigation.
    const currentHash = window.location.hash.replace(/^#/, "");
    const queryIdx = currentHash.indexOf("?");
    const embeddedQuery = queryIdx >= 0 ? currentHash.slice(queryIdx) : "";
    const target = `#${next}${embeddedQuery}`;
    if (window.location.hash === target) return;
    try {
      window.history.pushState({ tab: next }, "", target);
      setTabState(next);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      // Fallback for environments where pushState is restricted — direct
      // assignment fires hashchange which our listener catches.
      window.location.hash = target;
    }
  }, []);

  return { tab, setTab };
}
