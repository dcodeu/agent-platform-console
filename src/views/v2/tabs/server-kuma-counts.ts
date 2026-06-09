// Helpers for the Server tab's Kuma monitor count tile.
//
// Important distinction: heavy.upstream is an operator-curated bucket list
// (currently ~6 parent checks). The full Uptime Kuma monitor total comes from
// Kuma's Prometheus exporter, one monitor_status series per real monitor.

import { formatCount } from "../data/format.ts";

export const KUMA_TOTAL_PROMQL = "count(monitor_status)";
export const KUMA_UP_PROMQL = "count(monitor_status == 1)";

export function kumaDownCount(total: number | null, up: number | null): number | null {
  if (total == null || up == null) return null;
  return Math.max(0, total - up);
}

export function formatKumaMonitorValue(up: number | null, total: number | null): string {
  if (up == null || total == null) return "—";
  return `${formatCount(up)} of ${formatCount(total)}`;
}

export function formatKumaMonitorSub(down: number | null): string {
  if (down == null) return "Uptime checks reporting in";
  return down === 0 ? "all monitors up" : `${formatCount(down)} monitors down`;
}
