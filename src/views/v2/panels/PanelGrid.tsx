// PanelGrid — responsive layout container for 2–4 IframePanels.
//
// Breakpoints mirror KpiGrid: 1-col mobile → 2-col tablet → up to 4-col
// desktop. The desktop column count adapts to child count (2/3/4) via a CSS
// custom property so 3-panel rows don't get awkwardly stretched.

import type { ReactNode } from "react";

import "./PanelGrid.css";

export interface PanelGridProps {
  children: ReactNode;
  /** Desktop column count (1–4). Defaults based on `cols` prop or 4. */
  cols?: 1 | 2 | 3 | 4;
  /** Optional section title rendered above the grid. */
  title?: string;
  /** Optional small caption shown next to the title (e.g. "live · 24h"). */
  caption?: string;
}

export function PanelGrid({ children, cols = 4, title, caption }: PanelGridProps) {
  const grid = (
    <div
      className="y2-panel-grid"
      style={{ ["--y2-panel-cols" as string]: cols }}
    >
      {children}
    </div>
  );

  if (!title) return grid;

  return (
    <section className="y2-panel-section" aria-label={title}>
      <header className="y2-panel-section-h">
        <h2>{title}</h2>
        {caption && <span className="y2-panel-section-sub">{caption}</span>}
      </header>
      {grid}
    </section>
  );
}
