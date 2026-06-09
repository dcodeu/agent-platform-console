// range.ts — global time-window selector for the v2 cockpit.
//
// The Y2 subnav exposes a "Last 6h" pill that should drive every native
// widget across all tabs. Source of truth: the `?range=<key>` search param
// on window.location (preserving any existing hash like `#spend`).
//
// Hooks:
//   useRange()        — read + setter for the active range key.
//   useRangeWindow()  — derived (start, end, stepSec) for the active range.
//
// The hash router (use-tab-router) controls the `#tab` fragment; this module
// controls the `?range=` query. They live side-by-side and don't fight.

import { useCallback, useEffect, useState } from "react";

export type RangeKey = "1h" | "6h" | "24h" | "7d" | "30d" | "mtd";

export interface RangeDef {
  key: RangeKey;
  label: string;
  /** Window length in seconds (for fixed windows). MTD is computed live. */
  durationSec: number;
  /** Suggested Prometheus step in seconds; aim for ~120 points per window. */
  defaultStepSec: number;
  /** SQL interval expression for `now() - interval '<expr>'`. */
  sqlInterval: string;
}

const HOUR = 3600;
const DAY = 86400;

export const RANGES: readonly RangeDef[] = [
  { key: "1h",  label: "Last 1 hour",  durationSec: 1 * HOUR,  defaultStepSec: 30,  sqlInterval: "1 hour" },
  { key: "6h",  label: "Last 6 hours",  durationSec: 6 * HOUR,  defaultStepSec: 180, sqlInterval: "6 hours" },
  { key: "24h", label: "Last 24 hours", durationSec: 24 * HOUR, defaultStepSec: 600, sqlInterval: "24 hours" },
  { key: "7d",  label: "Last 7 days",  durationSec: 7 * DAY,   defaultStepSec: 3600, sqlInterval: "7 days" },
  { key: "30d", label: "Last 30 days", durationSec: 30 * DAY,  defaultStepSec: 14400, sqlInterval: "30 days" },
  { key: "mtd", label: "Month to date", durationSec: 30 * DAY, defaultStepSec: 14400, sqlInterval: "30 days" },
] as const;

export const DEFAULT_RANGE: RangeKey = "6h";

const VALID_KEYS = new Set<RangeKey>(RANGES.map((r) => r.key));

export function isRangeKey(v: string): v is RangeKey {
  return VALID_KEYS.has(v as RangeKey);
}

export function rangeDef(key: RangeKey): RangeDef {
  return RANGES.find((r) => r.key === key) ?? RANGES[1];
}

// ─── URL helpers ────────────────────────────────────────────────────

/**
 * Parse the active range key from the URL. We support two storage forms:
 *   - canonical:  `#<tab>?range=<key>`  (range lives inside the hash)
 *   - fallback:   `?range=<key>`         (top-level search string)
 * The first form is what the cockpit emits; the second exists so deep links
 * pasted with a real query string still resolve.
 */
function readRangeFromUrl(): RangeKey {
  if (typeof window === "undefined") return DEFAULT_RANGE;
  const hash = window.location.hash.replace(/^#/, "");
  const hashQ = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const hashParams = new URLSearchParams(hashQ);
  const fromHash = (hashParams.get("range") ?? "").trim().toLowerCase();
  if (fromHash) return isRangeKey(fromHash) ? fromHash : DEFAULT_RANGE;
  const search = new URLSearchParams(window.location.search);
  const fromSearch = (search.get("range") ?? "").trim().toLowerCase();
  if (!fromSearch) return DEFAULT_RANGE;
  return isRangeKey(fromSearch) ? fromSearch : DEFAULT_RANGE;
}

function writeRangeToUrl(next: RangeKey): void {
  if (typeof window === "undefined") return;
  // Canonical form is `#<tab>?range=<key>`. Strip the range from the hash
  // first, then re-append unless it's the default.
  const fullHash = window.location.hash.replace(/^#/, "");
  const qIdx = fullHash.indexOf("?");
  const tabPart = qIdx >= 0 ? fullHash.slice(0, qIdx) : fullHash;
  const queryPart = qIdx >= 0 ? fullHash.slice(qIdx + 1) : "";
  const params = new URLSearchParams(queryPart);
  if (next === DEFAULT_RANGE) {
    params.delete("range");
  } else {
    params.set("range", next);
  }
  const rebuilt = params.toString();
  const newHash = rebuilt ? `#${tabPart}?${rebuilt}` : tabPart ? `#${tabPart}` : "";
  const target = `${window.location.pathname}${window.location.search}${newHash}`;
  try {
    window.history.replaceState({ ...(window.history.state ?? {}), range: next }, "", target);
  } catch {
    // No-op fallback; range still lives in React state via useRange().
  }
}

// ─── Hooks ──────────────────────────────────────────────────────────

export interface UseRangeResult {
  range: RangeKey;
  setRange: (next: RangeKey) => void;
  def: RangeDef;
  durationSec: number;
  defaultStepSec: number;
}

/**
 * Range state hook. Reads from URL on mount, listens for popstate so the
 * back/forward buttons restore prior ranges, writes via replaceState (no
 * history entry per click — feels like a setting, not a navigation).
 */
export function useRange(): UseRangeResult {
  const [range, setRangeState] = useState<RangeKey>(() => readRangeFromUrl());

  useEffect(() => {
    const sync = () => setRangeState(readRangeFromUrl());
    window.addEventListener("popstate", sync);
    // hashchange fires when the tab router pushes a new hash; the range param
    // is preserved by writeRangeToUrl, but listen anyway for safety.
    window.addEventListener("hashchange", sync);
    sync();
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  const setRange = useCallback((next: RangeKey) => {
    if (!isRangeKey(next)) return;
    writeRangeToUrl(next);
    setRangeState(next);
  }, []);

  const def = rangeDef(range);
  return {
    range,
    setRange,
    def,
    durationSec: def.durationSec,
    defaultStepSec: def.defaultStepSec,
  };
}

export interface RangeWindow {
  /** Unix seconds. */
  startSec: number;
  /** Unix seconds. */
  endSec: number;
  /** JS Date for callers that prefer them. */
  start: Date;
  end: Date;
  /** Recommended step for Prometheus range queries. */
  stepSec: number;
}

/**
 * Derive a concrete (start, end, step) window from the active range key.
 * MTD is computed against UTC month start; everything else is `end - duration`.
 */
export function useRangeWindow(range: RangeKey): RangeWindow {
  const def = rangeDef(range);
  const endSec = Math.floor(Date.now() / 1000);
  let startSec: number;
  if (range === "mtd") {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    startSec = Math.floor(monthStart.getTime() / 1000);
  } else {
    startSec = endSec - def.durationSec;
  }
  return {
    startSec,
    endSec,
    start: new Date(startSec * 1000),
    end: new Date(endSec * 1000),
    stepSec: def.defaultStepSec,
  };
}
