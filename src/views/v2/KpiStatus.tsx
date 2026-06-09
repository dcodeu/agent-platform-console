// KpiStatus — pulsing teal dot + state label + count + supporting line.
//
// Used for "iMessage queue". The pulse animates with the global y2-pulse
// keyframes (defined in AppShell.css).

import type { ReactNode } from "react";

import "./KpiStatus.css";

export interface KpiStatusProps {
  title: ReactNode;
  /** Primary state label, e.g. "Drained". Rendered in teal accent. */
  state: ReactNode;
  /** Small count line under state, e.g. "2 in flight". */
  count: ReactNode;
  /** Supporting detail line, e.g. "87 sent today · p95 187ms · 0 failed". */
  sub: ReactNode;
}

export function KpiStatus({ title, state, count, sub }: KpiStatusProps) {
  return (
    <div className="y2-tile y2-k-status">
      <header className="y2-tile-h">
        <h3>{title}</h3>
        <span className="y2-tile-src y2-tile-src-g">
          <span className="y2-tile-lbl">scene · stat</span>
        </span>
      </header>
      <div className="y2-tile-b">
        <div className="y2-k-status-row">
          <div className="y2-k-status-pulse" aria-hidden="true" />
          <div className="y2-k-status-label">
            <div className="y2-k-status-big">{state}</div>
            <div className="y2-k-status-ct">{count}</div>
          </div>
        </div>
        <div className="y2-k-status-sub">{sub}</div>
      </div>
    </div>
  );
}
