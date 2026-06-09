// StatusPill — colored pill for state labels.

import { displayStatusLabel } from "../data/display.ts";
import "./StatusPill.css";

export type PillState = "ok" | "warn" | "alert" | "info" | "idle";

export interface StatusPillProps {
  state: PillState;
  label: string;
  /** If true, pulse the dot (use for "running"). */
  pulse?: boolean;
}

export function StatusPill({ state, label, pulse }: StatusPillProps) {
  return (
    <span className={`w-pill w-pill-${state}${pulse ? " is-pulse" : ""}`}>
      <span className="w-pill-dot" aria-hidden="true" />
      {displayStatusLabel(label)}
    </span>
  );
}
