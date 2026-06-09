// CategorySubNav — contextual sub-nav that appears only when the current
// tab belongs to a category with >1 sub. Replaces the old always-present
// global `.y2-subnav` strip. Layout mirrors the prior subnav: tabs on the
// left, meta (RangeSelect) on the right.

import type { ReactNode } from "react";

import { RangeSelect } from "../RangeSelect.tsx";
import type { TabKey } from "../tabs/tab-registry.ts";
import { categoryForTab } from "./nav-config.ts";
import "./CategorySubNav.css";

export interface CategorySubNavProps {
  activeTab: TabKey;
  onTabChange: (next: TabKey) => void;
  /** Optional override for the right-side meta region. Defaults to RangeSelect. */
  meta?: ReactNode;
}

export function CategorySubNav({
  activeTab,
  onTabChange,
  meta,
}: CategorySubNavProps) {
  const category = categoryForTab(activeTab);

  // No render if: orphan tab, single-sub category (e.g. cockpit), or unknown.
  if (!category || category.subs.length <= 1) return null;

  return (
    <div
      className="y2-csub"
      role="tablist"
      aria-label={`${category.label} sections`}
    >
      {category.subs.map((sub) => {
        const on = sub.tab === activeTab;
        return (
          <button
            key={sub.tab}
            type="button"
            className={`y2-csub-tab${on ? " is-active on" : ""}`}
            role="tab"
            aria-selected={on ? "true" : "false"}
            onClick={() => onTabChange(sub.tab)}
          >
            {sub.label}
          </button>
        );
      })}
      <div className="y2-csub-meta">{meta ?? <RangeSelect />}</div>
    </div>
  );
}
