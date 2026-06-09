// AppShell — Y2 cockpit chrome (topbar + contextual sub-nav + main + bottom-nav + FAB).
//
// Nav IA: one consolidated PrimaryNav lives in the topbar (5 categories,
// each either a direct link or a dropdown). A contextual CategorySubNav
// renders only when the active tab's category has multiple siblings — so
// Cockpit (single-sub) is chromeless under the topbar.

import { useEffect, type ReactNode } from "react";

import { Icon } from "./icon-sprite.tsx";
import { BottomNav } from "./BottomNav.tsx";
import { FabActivity } from "./FabActivity.tsx";
import { PrimaryNav } from "./nav/PrimaryNav.tsx";
import { CategorySubNav } from "./nav/CategorySubNav.tsx";
import { categoryForTab } from "./nav/nav-config.ts";
import { type TabKey, DEFAULT_TAB } from "./tabs/tab-registry.ts";
import { useTabRouter } from "./tabs/use-tab-router.ts";
import { useApprovalsCount } from "./tabs/use-approvals-count.ts";
import "./AppShell.css";

export interface AppShellProps {
  children?: ReactNode;
  tab?: TabKey;
  onTabChange?: (next: TabKey) => void;
}

export function AppShell({ children, tab, onTabChange }: AppShellProps) {
  // Fallback wiring: if caller doesn't pass tab+onTabChange, use the router
  // directly. Lets the shell be self-sufficient if mounted standalone.
  const fallback = useTabRouter();
  const activeTab: TabKey = tab ?? fallback.tab ?? DEFAULT_TAB;
  const setTab = onTabChange ?? fallback.setTab;
  const approvalsCount = useApprovalsCount();

  const category = categoryForTab(activeTab);
  const hasSubNav = (category?.subs.length ?? 0) > 1;

  useEffect(() => {
    document.body.classList.toggle("ticker-rail-no-subnav", !hasSubNav);
    return () => {
      document.body.classList.remove("ticker-rail-no-subnav");
    };
  }, [hasSubNav]);

  return (
    <>
      <div className="y2-topbar">
        <button className="y2-hamburger" aria-label="Menu" type="button">
          <Icon name="menu" size={18} />
        </button>
        <div className="y2-brand">
          <span className="y2-brand-g" aria-hidden="true">
            A
          </span>
          <span className="y2-brand-name">Agent Platform</span>
        </div>
        <PrimaryNav activeTab={activeTab} onTabChange={setTab} />
        <button
          className="y2-search"
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("open-command-palette"))
          }
          aria-label="Open command palette"
        >
          <Icon name="search" size={16} />
          <span className="y2-search-placeholder">
            Search agents, runs, costs…
          </span>
          <span className="y2-kbd">⌘K</span>
        </button>
        <div className="y2-health">
          <span className="y2-health-d" aria-hidden="true" />
          healthy
        </div>
        <div className="y2-me" aria-label="Account" />
      </div>

      <CategorySubNav activeTab={activeTab} onTabChange={setTab} />

      <main className={`y2-page${hasSubNav ? "" : " no-subnav"}`}>
        {children}
      </main>

      <BottomNav
        tab={activeTab}
        onTabChange={setTab}
        approvalsCount={approvalsCount}
      />
      <FabActivity />
    </>
  );
}
