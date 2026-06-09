// RangeSelect — pill-shaped dropdown that drives the global time-range.
//
// Shape matches the original inert `.y2-pill.y2-pill-tp` pill so the subnav
// rhythm is preserved. Behavior: click or Enter/Space opens; arrow keys
// navigate; Enter selects; Esc closes.

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { RANGES } from "./data/range.ts";
import { useRangeContext } from "./data/RangeContext.tsx";
import "./RangeSelect.css";

export function RangeSelect() {
  const { range, setRange, def } = useRangeContext();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number>(() =>
    Math.max(0, RANGES.findIndex((r) => r.key === range)),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Keep hover synced with the active range when the menu opens.
  useEffect(() => {
    if (open) {
      const idx = RANGES.findIndex((r) => r.key === range);
      setHover(idx >= 0 ? idx : 0);
    }
  }, [open, range]);

  const choose = useCallback(
    (idx: number) => {
      const item = RANGES[idx];
      if (!item) return;
      setRange(item.key);
      setOpen(false);
    },
    [setRange],
  );

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHover((h) => (h + 1) % RANGES.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHover((h) => (h - 1 + RANGES.length) % RANGES.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setHover(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHover(RANGES.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(hover);
    }
  };

  return (
    <div className="y2-range" ref={rootRef}>
      <button
        type="button"
        className="y2-pill y2-pill-tp y2-range-btn"
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        {def.label} <b>▾</b>
      </button>
      {open ? (
        <ul
          id={menuId}
          role="listbox"
          aria-label="Time range"
          className="y2-range-menu"
          tabIndex={-1}
          ref={(el) => {
            // Auto-focus the menu when it opens so arrow keys work.
            if (el) el.focus();
          }}
          onKeyDown={onMenuKeyDown}
        >
          {RANGES.map((r, idx) => {
            const on = r.key === range;
            const hovered = idx === hover;
            return (
              <li
                key={r.key}
                role="option"
                aria-selected={on ? "true" : "false"}
                className={`y2-range-opt${on ? " is-on" : ""}${hovered ? " is-hover" : ""}`}
                onMouseEnter={() => setHover(idx)}
                onMouseDown={(e) => {
                  // mousedown beats the document mousedown listener that closes us.
                  e.preventDefault();
                  choose(idx);
                }}
              >
                <span className="y2-range-opt-l">{r.label}</span>
                {on ? <span className="y2-range-opt-mk">✓</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
