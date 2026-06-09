// NativeStat — single big-number stat tile.
//
// Big mono numeral; optional delta chip (teal=positive, coral=negative)
// and a sub line. Used for "Tokens · MTD", "Active workflows", etc.

import type { ReactNode } from "react";
import { WidgetCard } from "./WidgetCard.tsx";
import "./NativeStat.css";

export interface NativeStatDelta {
  value: number;
  positive: boolean;
  /** Optional pre-formatted label, e.g. "+12%". If absent we render the numeric value with a sign. */
  label?: string;
}

export interface NativeStatProps {
  title: ReactNode;
  value: ReactNode;
  unit?: string;
  delta?: NativeStatDelta;
  sub?: ReactNode;
  source?: string;
  loading?: boolean;
  error?: string | null;
}

export function NativeStat({
  title,
  value,
  unit,
  delta,
  sub,
  source,
  loading,
  error,
}: NativeStatProps) {
  return (
    <WidgetCard title={title} source={source} kind="stat" loading={loading} error={error}>
      <div className="w-stat-n">
        <span className="w-stat-num">{value}</span>
        {unit ? <span className="w-stat-unit">{unit}</span> : null}
      </div>
      {(delta || sub) && (
        <div className="w-stat-meta">
          {delta ? (
            <span
              className={`w-stat-delta${delta.positive ? " is-pos" : " is-neg"}`}
              aria-label={`delta ${delta.label ?? delta.value}`}
            >
              {delta.label ?? (delta.positive ? "+" : "") + String(delta.value)}
            </span>
          ) : null}
          {sub ? <span className="w-stat-sub">{sub}</span> : null}
        </div>
      )}
    </WidgetCard>
  );
}
