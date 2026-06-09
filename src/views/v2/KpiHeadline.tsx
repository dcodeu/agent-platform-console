// KpiHeadline — big teal number + coral delta + budget bar.
//
// Used for "Spend · MTD". The budget bar fills proportionally to spent /
// budget. The delta chip is coral when positive (i.e., over-trend).

import type { ReactNode } from "react";

import "./KpiHeadline.css";

export interface KpiHeadlineProps {
  title: ReactNode;
  /** Formatted, e.g. "$47.18" — caller owns currency/locale formatting. */
  value: ReactNode;
  /** Formatted delta vs comparison period, e.g. "+12%". */
  delta: ReactNode;
  /** Projection meta, e.g. "proj $94". */
  projection: ReactNode;
  /** Budget meta, e.g. "budget $200". */
  budget: ReactNode;
  /** Percent of budget consumed, 0..100. Clamped on render. */
  consumedPct: number;
}

export function KpiHeadline({
  title,
  value,
  delta,
  projection,
  budget,
  consumedPct,
}: KpiHeadlineProps) {
  const pct = Math.max(0, Math.min(100, consumedPct));
  return (
    <div className="y2-tile y2-k-headline">
      <header className="y2-tile-h">
        <h3>{title}</h3>
        <span className="y2-tile-src y2-tile-src-g">
          <span className="y2-tile-lbl">scene · stat</span>
        </span>
      </header>
      <div className="y2-tile-b">
        <div className="y2-k-headline-row">
          <div className="y2-k-headline-n">{value}</div>
          <span className="y2-k-headline-delta">{delta}</span>
        </div>
        <div className="y2-k-headline-budget">
          <div className="y2-k-headline-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="y2-k-headline-meta">
            <span>{projection}</span>
            <span>{budget}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
