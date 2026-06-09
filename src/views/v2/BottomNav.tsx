// BottomNav — mobile-only 5-tab nav fixed to the bottom edge.
//
// Hidden at >=1024px. Items mirror the desktop PrimaryNav: 4 categories
// (each routes to its first sub) + Approvals (event). Active state lights
// when the current tab belongs to the category, even if it's a non-first
// sub of that group.

import type { IconName } from "./icon-sprite.tsx";
import { Icon } from "./icon-sprite.tsx";
import {
  APPROVALS_NAV,
  NAV,
  categoryForTab,
  firstTabOf,
  type CategoryKey,
} from "./nav/nav-config.ts";
import type { TabKey } from "./tabs/tab-registry.ts";
import "./BottomNav.css";

export interface BottomNavProps {
  tab?: TabKey;
  onTabChange?: (next: TabKey) => void;
  approvalsCount?: number;
}

interface BottomItem {
  key: CategoryKey | "approvals";
  label: string;
  icon: IconName;
}

export function BottomNav({ tab, onTabChange, approvalsCount = 0 }: BottomNavProps) {
  const activeCategory = tab ? categoryForTab(tab) : null;

  const items: BottomItem[] = NAV.map((c) => ({
    key: c.key,
    label: c.label,
    icon: c.icon ?? "layout-dashboard",
  }));
  items.push({
    key: "approvals",
    label: APPROVALS_NAV.label,
    icon: APPROVALS_NAV.icon,
  });

  const handleClick = (key: BottomItem["key"]) => {
    if (key === "approvals") {
      window.dispatchEvent(new CustomEvent(APPROVALS_NAV.event));
      onTabChange?.("overview");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const cat = NAV.find((c) => c.key === key);
    if (!cat || !onTabChange) return;
    onTabChange(firstTabOf(cat));
  };

  return (
    <nav className="y2-bnav" aria-label="Primary">
      {items.map((it) => {
        const on = it.key !== "approvals" && activeCategory?.key === it.key;
        const badge =
          it.key === "approvals" && approvalsCount > 0 ? approvalsCount : undefined;
        return (
          <button
            key={it.key}
            type="button"
            className={on ? "on" : undefined}
            onClick={() => handleClick(it.key)}
            aria-current={on ? "page" : undefined}
          >
            <span className="y2-bnav-ic">
              <Icon name={it.icon} size={22} />
            </span>
            {it.label}
            {badge !== undefined ? (
              <span className="y2-bnav-badge" aria-label={`${badge} pending`}>
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
