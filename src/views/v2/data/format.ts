// format.ts — pure formatters used by the v2 KPI tiles.
//
// All helpers are total functions: NaN / null / undefined / negative inputs
// always return a stable fallback ("—" for empty, "0" for counts) so the UI
// never renders "NaN" or "Invalid Date".

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const COUNT = new Intl.NumberFormat("en-US");

export function formatUsd(n: number | null | undefined, opts?: { whole?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return opts?.whole ? USD_WHOLE.format(n) : USD.format(n);
}

export function formatLatencyMs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  const seconds = n / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  return COUNT.format(Math.round(n));
}

/**
 * "2m ago" / "13s ago" / "3h ago" / "2d ago" / "just now".
 * Accepts ISO 8601, an epoch millis number, or null.
 */
export function formatRelativeTime(
  input: string | number | null | undefined,
  now: number = Date.now(),
): string {
  if (input == null) return "—";
  const ms = typeof input === "number" ? input : Date.parse(input);
  if (!Number.isFinite(ms)) return "—";
  const diff = Math.max(0, now - ms);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Compact token formatter: 1234 → "1.2k", 1_234_567 → "1.2M",
 * 1_234_000_000 → "1.2B". Returns "0" for null/NaN/0.
 */
export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  if (abs < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/**
 * 0..1 ratio formatted to "87.0%". For null/NaN returns "—".
 */
export function formatPercent(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * "1.2s" / "12s" / "1m 23s" / "2h 5m". For null/NaN returns "—".
 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 10) return `${(ms / 1000).toFixed(1)}s`;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const remm = m % 60;
  return `${h}h ${remm}m`;
}
