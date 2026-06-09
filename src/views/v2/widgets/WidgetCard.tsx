// WidgetCard — shared chrome for all native widgets.
//
// Tile chrome same shape as KpiStat/KpiHeadline: title row + body slot +
// optional footer slot. Honors loading/error states with coral-tinted
// surface (loading = neutral dim; error = --attn).

import type { ReactNode } from "react";
import { displaySourceLabel } from "../data/display.ts";
import "./WidgetCard.css";

export type WidgetKind = "stat" | "chart" | "list";

export interface WidgetCardProps {
  title: ReactNode;
  /** Tiny mono label that lives to the right of the title. */
  source?: string;
  /** Optional element rendered between title and source — e.g. a status pill. */
  badge?: ReactNode;
  /** Hints intended layout; reserved for future variants. */
  kind?: WidgetKind;
  /** When true, render the loading bar instead of children. */
  loading?: boolean;
  /** When set, render an error state with this message instead of children. */
  error?: string | null;
  /** Optional small footer (right-aligned). */
  footer?: ReactNode;
  /** When true, drop body padding so the child controls its own gutters. */
  flush?: boolean;
  children?: ReactNode;
}

export function WidgetCard({
  title,
  source,
  badge,
  loading,
  error,
  footer,
  flush,
  children,
}: WidgetCardProps) {
  return (
    <div className={`w-card${error ? " w-card-error" : ""}`}>
      <header className="w-card-h">
        <h3>{title}</h3>
        <span className="w-card-meta">
          {badge}
          {source ? <span className="w-card-src">{displaySourceLabel(source)}</span> : null}
        </span>
      </header>
      <div className={`w-card-b${flush ? " w-card-b-flush" : ""}`}>
        {error ? (
          <div className="w-card-error-msg" role="alert">{error}</div>
        ) : loading ? (
          <div className="w-card-loading">loading…</div>
        ) : (
          children
        )}
      </div>
      {footer ? <footer className="w-card-f">{footer}</footer> : null}
    </div>
  );
}
