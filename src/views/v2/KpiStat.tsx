// KpiStat — horizontal layout: big number on the left, stacked facts on the right.
//
// Used for "Invocations · 6h". `facts` is a tuple of small lines, each with
// optional bold emphasis on the leading or trailing fragment.

import type { ReactNode } from "react";

import "./KpiStat.css";

export interface KpiStatProps {
  title: ReactNode;
  value: ReactNode;
  /** 3–4 short lines, e.g. ["p95 312ms", "0 failed", "+8 vs prev"]. */
  facts: ReactNode[];
}

export function KpiStat({ title, value, facts }: KpiStatProps) {
  return (
    <div className="y2-tile y2-k-stat">
      <header className="y2-tile-h">
        <h3>{title}</h3>
        <span className="y2-tile-src y2-tile-src-g">
          <span className="y2-tile-lbl">scene · stat</span>
        </span>
      </header>
      <div className="y2-tile-b">
        <div className="y2-k-stat-hbox">
          <div className="y2-k-stat-n">{value}</div>
          <div className="y2-k-stat-aside">
            {facts.map((fact, i) => (
              <div key={i}>{fact}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
