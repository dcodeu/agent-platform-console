// PrimaryNav — consolidated topbar nav. Each NAV category renders as either
// a direct link (single sub) or a dropdown trigger (multiple subs). The
// Approvals item is a direct event-handler item (no tab/category).
//
// A11y: dropdown trigger uses aria-haspopup="menu" + aria-expanded; the
// menu uses role="menu" and items use role="menuitem". Keyboard:
//   - ArrowDown on trigger opens menu and focuses first item
//   - ArrowDown/ArrowUp navigate items, wrap at edges
//   - Enter / Space selects
//   - Escape closes and returns focus to trigger
//   - Outside click closes

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "../icon-sprite.tsx";
import type { TabKey } from "../tabs/tab-registry.ts";
import { useApprovalsCount } from "../tabs/use-approvals-count.ts";
import {
  NAV,
  categoryForTab,
  type NavCategory,
  type NavSubItem,
} from "./nav-config.ts";
import "./PrimaryNav.css";

export interface PrimaryNavProps {
  activeTab: TabKey;
  onTabChange: (next: TabKey) => void;
}

export function PrimaryNav({ activeTab, onTabChange }: PrimaryNavProps) {
  const activeCategory = categoryForTab(activeTab);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const approvalsCount = useApprovalsCount();

  const navRef = useRef<HTMLElement | null>(null);

  // Outside click + Escape closes any open dropdown.
  useEffect(() => {
    if (openKey == null) return;
    const onDocClick = (e: MouseEvent) => {
      if (!navRef.current) return;
      if (!navRef.current.contains(e.target as Node)) setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  return (
    <nav className="y2-pnav" aria-label="Primary" ref={navRef}>
      {NAV.map((cat) => {
        const isActive = activeCategory?.key === cat.key;
        if (cat.subs.length <= 1) {
          const sub = cat.subs[0];
          const badge =
            cat.key === "approvals" && approvalsCount > 0
              ? approvalsCount
              : undefined;
          return (
            <DirectLink
              key={cat.key}
              cat={cat}
              sub={sub}
              active={isActive}
              badge={badge}
              onSelect={() => {
                setOpenKey(null);
                onTabChange(sub.tab);
              }}
            />
          );
        }
        return (
          <DropdownItem
            key={cat.key}
            cat={cat}
            active={isActive}
            activeTab={activeTab}
            open={openKey === cat.key}
            onToggle={(next) => setOpenKey(next ? cat.key : null)}
            onSelect={(tab) => {
              setOpenKey(null);
              onTabChange(tab);
            }}
          />
        );
      })}
    </nav>
  );
}

interface DirectLinkProps {
  cat: NavCategory;
  sub: NavSubItem;
  active: boolean;
  onSelect: () => void;
  badge?: number;
}

function DirectLink({ cat, sub, active, onSelect, badge }: DirectLinkProps) {
  return (
    <a
      className={`y2-pnav-item y2-pnav-direct${active ? " on" : ""}`}
      href={`#${sub.tab}`}
      onClick={(e) => {
        e.preventDefault();
        onSelect();
      }}
      aria-current={active ? "page" : undefined}
    >
      {cat.icon ? <Icon name={cat.icon} size={14} /> : null}
      <span className="y2-pnav-label">
        <span>{cat.label}</span>
        {badge !== undefined ? (
          <span
            className="y2-pnav-badge"
            aria-label={`${badge} pending approval${badge === 1 ? "" : "s"}`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
    </a>
  );
}

interface DropdownItemProps {
  cat: NavCategory;
  active: boolean;
  activeTab: TabKey;
  open: boolean;
  onToggle: (next: boolean) => void;
  onSelect: (tab: TabKey) => void;
}

function DropdownItem({
  cat,
  active,
  activeTab,
  open,
  onToggle,
  onSelect,
}: DropdownItemProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIdx, setFocusIdx] = useState<number>(-1);

  // When opening, focus the first (or active) item.
  useEffect(() => {
    if (!open) {
      setFocusIdx(-1);
      return;
    }
    const idx = Math.max(
      0,
      cat.subs.findIndex((s) => s.tab === activeTab),
    );
    setFocusIdx(idx);
  }, [open, cat.subs, activeTab]);

  useEffect(() => {
    if (!open || focusIdx < 0) return;
    itemRefs.current[focusIdx]?.focus();
  }, [open, focusIdx]);

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      onToggle(false);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => (i + 1) % cat.subs.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => (i - 1 + cat.subs.length) % cat.subs.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusIdx(cat.subs.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onToggle(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      // Allow Tab to close the menu naturally.
      onToggle(false);
    }
  };

  return (
    <div className={`y2-pnav-dd${open ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`y2-pnav-item y2-pnav-trigger${active ? " on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        aria-controls={menuId}
        onClick={() => onToggle(!open)}
        onKeyDown={onTriggerKeyDown}
      >
        {cat.icon ? <Icon name={cat.icon} size={14} /> : null}
        <span>{cat.label}</span>
        <span className="y2-pnav-chev" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={cat.label}
          className="y2-pnav-menu"
          onKeyDown={onMenuKeyDown}
        >
          {cat.subs.map((sub, idx) => {
            const on = sub.tab === activeTab;
            return (
              <button
                key={sub.tab}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitem"
                className={`y2-pnav-mi${on ? " is-on" : ""}`}
                tabIndex={focusIdx === idx ? 0 : -1}
                onMouseEnter={() => setFocusIdx(idx)}
                onClick={() => onSelect(sub.tab)}
              >
                {sub.icon ? <Icon name={sub.icon} size={14} /> : null}
                <span className="y2-pnav-mi-l">{sub.label}</span>
                {on ? (
                  <span className="y2-pnav-mi-mk" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
