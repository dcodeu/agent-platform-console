// useNativeData — small TanStack-Query hooks around /api/metrics/* proxies.
//
// All three endpoints are JSON: Prometheus (vector or matrix), Loki (streams),
// Postgres (SELECT-only). Defaults: instant prom refetch 20s, range prom 60s,
// loki 10s.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

// ─── Prometheus ─────────────────────────────────────────────────────

export interface PromValue {
  /** Unix seconds (Prom returns [ts, "value"] where value is a string). */
  ts: number;
  value: number;
  labels: Record<string, string>;
}

export interface PromMatrixSeries {
  labels: Record<string, string>;
  /** Tuples of [unix seconds, value]. */
  values: Array<[number, number]>;
}

export interface PromRangeOpts {
  /** Unix seconds. Defaults to now - 3600. */
  start?: number;
  /** Unix seconds. Defaults to now. */
  end?: number;
  /** Step in seconds. Defaults to 60. */
  step?: number;
  /** Refetch interval ms. */
  refetchMs?: number;
  /** Disable the query. */
  enabled?: boolean;
}

interface PromResponse {
  status: string;
  data: {
    resultType: "vector" | "matrix" | "scalar" | "string";
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
  error?: string;
  errorType?: string;
}

async function fetchProm(url: string, signal: AbortSignal): Promise<PromResponse> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`prom ${res.status}`);
  const data = (await res.json()) as PromResponse;
  if (data.status !== "success") {
    throw new Error(data.error ?? "prom query failed");
  }
  return data;
}

/** Instant Prometheus query — single time-point per series. */
export function usePromInstant(
  promql: string,
  opts: { refetchMs?: number; enabled?: boolean } = {},
): UseQueryResult<PromValue[]> {
  const refetch = opts.refetchMs ?? 20_000;
  return useQuery({
    queryKey: ["prom-instant", promql],
    enabled: opts.enabled !== false && promql.length > 0,
    refetchInterval: refetch,
    staleTime: Math.floor(refetch * 0.8),
    queryFn: async ({ signal }) => {
      const url = `/api/metrics/prom?q=${encodeURIComponent(promql)}`;
      const data = await fetchProm(url, signal);
      const out: PromValue[] = [];
      for (const r of data.data.result) {
        if (!r.value) continue;
        const [ts, v] = r.value;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        out.push({ ts, value: n, labels: r.metric });
      }
      return out;
    },
  });
}

/** Range Prometheus query — matrix of values per series. */
export function usePromQuery(
  promql: string,
  opts: PromRangeOpts = {},
): UseQueryResult<PromMatrixSeries[]> {
  const refetch = opts.refetchMs ?? 60_000;
  const step = opts.step ?? 60;
  return useQuery({
    queryKey: ["prom-range", promql, opts.start ?? "auto", opts.end ?? "auto", step],
    enabled: opts.enabled !== false && promql.length > 0,
    refetchInterval: refetch,
    staleTime: Math.floor(refetch * 0.8),
    queryFn: async ({ signal }) => {
      const now = Math.floor(Date.now() / 1000);
      const start = opts.start ?? now - 3600;
      const end = opts.end ?? now;
      const url = `/api/metrics/prom?q=${encodeURIComponent(promql)}&start=${start}&end=${end}&step=${step}`;
      const data = await fetchProm(url, signal);
      const series: PromMatrixSeries[] = [];
      for (const r of data.data.result) {
        const vals = r.values ?? (r.value ? [r.value] : []);
        const points: Array<[number, number]> = [];
        for (const [ts, v] of vals) {
          const n = Number(v);
          if (Number.isFinite(n)) points.push([ts * 1000, n]);
        }
        series.push({ labels: r.metric, values: points });
      }
      return series;
    },
  });
}

// ─── Loki ──────────────────────────────────────────────────────────

export interface LokiEntry {
  /** Nanosecond-precision Unix timestamp as a number (ms-precision after divide). */
  ts: number;
  line: string;
  labels: Record<string, string>;
}

export interface LokiOpts {
  /** Nanosecond Unix timestamp. */
  start?: number;
  /** Nanosecond Unix timestamp. */
  end?: number;
  limit?: number;
  direction?: "backward" | "forward";
  refetchMs?: number;
  enabled?: boolean;
}

interface LokiResponse {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      stream: Record<string, string>;
      values: Array<[string, string]>;
    }>;
  };
}

export function useLokiQuery(
  logql: string,
  opts: LokiOpts = {},
): UseQueryResult<LokiEntry[]> {
  const refetch = opts.refetchMs ?? 10_000;
  const limit = opts.limit ?? 200;
  const direction = opts.direction ?? "backward";
  return useQuery({
    queryKey: ["loki", logql, opts.start ?? "auto", opts.end ?? "auto", limit, direction],
    enabled: opts.enabled !== false && logql.length > 0,
    refetchInterval: refetch,
    staleTime: Math.floor(refetch * 0.8),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("q", logql);
      params.set("limit", String(limit));
      params.set("direction", direction);
      if (opts.start != null) params.set("start", String(opts.start));
      if (opts.end != null) params.set("end", String(opts.end));
      const res = await fetch(`/api/metrics/loki?${params.toString()}`, {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`loki ${res.status}`);
      const data = (await res.json()) as LokiResponse;
      const out: LokiEntry[] = [];
      for (const stream of data.data.result) {
        for (const [tsNs, line] of stream.values) {
          // tsNs is a decimal string in ns; convert to ms (Number is safe up to 2^53).
          const ms = Number(tsNs) / 1e6;
          out.push({ ts: ms, line, labels: stream.stream });
        }
      }
      out.sort((a, b) => b.ts - a.ts);
      return out;
    },
  });
}

// ─── Loki (paged / cursor) ──────────────────────────────────────────
//
// usePagedLokiQuery — accumulates pages of entries in component state, with
// cursor-based pagination (the oldest entry's timestamp becomes the next
// `end`). The first page is also live-tailed (refetched every refetchMs) so
// the user sees new lines without scrolling.
//
// AbortController behavior:
//   * The "first page" is owned by useQuery — when queryKey changes, RQ
//     aborts the in-flight signal automatically.
//   * "Load older" pages use a manually-managed AbortController that we
//     abort whenever the query key changes (filters changed → drop the
//     old pagination cursor and start fresh).

interface PagedLokiFetchOpts {
  start: number;
  end: number;
  limit: number;
  signal: AbortSignal;
}

async function fetchLokiPage(logql: string, opts: PagedLokiFetchOpts): Promise<LokiEntry[]> {
  const params = new URLSearchParams();
  params.set("q", logql);
  params.set("limit", String(opts.limit));
  params.set("direction", "backward");
  params.set("start", String(opts.start));
  params.set("end", String(opts.end));
  const res = await fetch(`/api/metrics/loki?${params.toString()}`, {
    signal: opts.signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`loki ${res.status}`);
  const data = (await res.json()) as LokiResponse;
  const out: LokiEntry[] = [];
  for (const stream of data.data.result) {
    for (const [tsNs, line] of stream.values) {
      const ms = Number(tsNs) / 1e6;
      out.push({ ts: ms, line, labels: stream.stream });
    }
  }
  out.sort((a, b) => b.ts - a.ts); // newest first
  return out;
}

export interface PagedLokiOpts {
  /** Unix ns. Floor of the window — older entries are not fetched. */
  startNs: number;
  /** Unix ns. The "now" end of the window for the first page. */
  endNs: number;
  /** Page size. Default 100. */
  pageSize?: number;
  /** Cap total in-memory entries. Oldest beyond this are dropped. Default 1000. */
  maxBuffer?: number;
  /** Live-tail refetch interval in ms for the first page. Default 10_000. */
  refetchMs?: number;
  /** Disable the query. */
  enabled?: boolean;
}

export interface PagedLokiResult {
  /** Merged, newest-first, capped to maxBuffer. */
  entries: LokiEntry[];
  /** First-page fetch (live tail) is in flight. */
  isPending: boolean;
  /** Any page fetch (first or older) is in flight. */
  isFetching: boolean;
  /** Error from any page fetch. */
  error: Error | null;
  /** Trigger loading the next-older page. No-op while a load is in flight or at start of window. */
  loadOlder: () => void;
  /** True when more older entries can be requested (no end-of-window hit yet). */
  hasMore: boolean;
  /** Force re-issue of the first page (also drops any older-pages tail). */
  refresh: () => void;
}

export function usePagedLokiQuery(logql: string, opts: PagedLokiOpts): PagedLokiResult {
  const pageSize = opts.pageSize ?? 100;
  const maxBuffer = opts.maxBuffer ?? 1000;
  const refetchMs = opts.refetchMs ?? 10_000;
  const enabled = opts.enabled !== false && logql.length > 0;

  // Older-page state — keyed off (logql, window). Whenever the key changes we
  // wipe the older buffer and abort any in-flight older fetch.
  const queryKey = `${logql}|${opts.startNs}|${opts.endNs}|${pageSize}|${maxBuffer}`;
  const [olderEntries, setOlderEntries] = useState<LokiEntry[]>([]);
  const [olderFetching, setOlderFetching] = useState(false);
  const [olderError, setOlderError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const olderAbortRef = useRef<AbortController | null>(null);
  const keyRef = useRef(queryKey);

  // First page lives in TanStack Query so we get auto-refetch + auto-abort.
  const first = useQuery({
    queryKey: ["loki-paged-first", logql, opts.startNs, opts.endNs, pageSize],
    enabled,
    refetchInterval: refetchMs,
    staleTime: Math.floor(refetchMs * 0.8),
    queryFn: async ({ signal }) => {
      return fetchLokiPage(logql, {
        start: opts.startNs,
        end: opts.endNs,
        limit: pageSize,
        signal,
      });
    },
  });

  // When the query key changes, reset paginated state + abort any older fetch.
  useEffect(() => {
    if (keyRef.current === queryKey) return;
    keyRef.current = queryKey;
    if (olderAbortRef.current) {
      olderAbortRef.current.abort();
      olderAbortRef.current = null;
    }
    setOlderEntries([]);
    setOlderError(null);
    setOlderFetching(false);
    setHasMore(true);
  }, [queryKey]);

  // Clean up the abort controller on unmount.
  useEffect(() => {
    return () => {
      if (olderAbortRef.current) {
        olderAbortRef.current.abort();
        olderAbortRef.current = null;
      }
    };
  }, []);

  const loadOlder = useCallback(() => {
    if (!enabled || !hasMore || olderFetching) return;
    // Determine the cursor — oldest entry across (first page ∪ older buffer).
    const firstEntries = first.data ?? [];
    const merged = firstEntries.concat(olderEntries);
    if (merged.length === 0) return; // nothing to anchor against yet
    let oldestMs = merged[0].ts;
    for (const e of merged) if (e.ts < oldestMs) oldestMs = e.ts;
    const cursorNs = Math.max(opts.startNs, Math.floor(oldestMs * 1e6) - 1);
    if (cursorNs <= opts.startNs) {
      setHasMore(false);
      return;
    }
    const ctrl = new AbortController();
    olderAbortRef.current = ctrl;
    setOlderFetching(true);
    setOlderError(null);
    fetchLokiPage(logql, {
      start: opts.startNs,
      end: cursorNs,
      limit: pageSize,
      signal: ctrl.signal,
    })
      .then((page) => {
        if (ctrl.signal.aborted) return;
        if (page.length === 0) {
          setHasMore(false);
        } else if (page.length < pageSize) {
          setHasMore(false);
          setOlderEntries((prev) => prev.concat(page));
        } else {
          setOlderEntries((prev) => prev.concat(page));
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        if ((err as Error).name === "AbortError") return;
        setOlderError(err as Error);
      })
      .finally(() => {
        if (olderAbortRef.current === ctrl) olderAbortRef.current = null;
        setOlderFetching(false);
      });
  }, [enabled, hasMore, olderFetching, first.data, olderEntries, opts.startNs, logql, pageSize]);

  const refresh = useCallback(() => {
    if (olderAbortRef.current) {
      olderAbortRef.current.abort();
      olderAbortRef.current = null;
    }
    setOlderEntries([]);
    setOlderError(null);
    setOlderFetching(false);
    setHasMore(true);
    first.refetch();
  }, [first]);

  // Merge + dedupe (by ts+line+job) + cap.
  const merged: LokiEntry[] = [];
  const seen = new Set<string>();
  const firstEntries = first.data ?? [];
  for (const e of firstEntries) {
    const k = `${e.ts}|${e.line}|${e.labels.job ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(e);
  }
  for (const e of olderEntries) {
    const k = `${e.ts}|${e.line}|${e.labels.job ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(e);
  }
  merged.sort((a, b) => b.ts - a.ts);
  const capped = merged.length > maxBuffer ? merged.slice(0, maxBuffer) : merged;

  return {
    entries: capped,
    isPending: first.isPending,
    isFetching: first.isFetching || olderFetching,
    error: (first.error as Error | null) ?? olderError,
    loadOlder,
    hasMore,
    refresh,
  };
}

// ─── Postgres ─────────────────────────────────────────────────────

export interface PgResult {
  columns: string[];
  rows: unknown[][];
}

export interface PgOpts {
  refetchMs?: number;
  enabled?: boolean;
}

export function usePgQuery(sql: string, opts: PgOpts = {}): UseQueryResult<PgResult> {
  const refetch = opts.refetchMs ?? 60_000;
  return useQuery({
    queryKey: ["pg", sql],
    enabled: opts.enabled !== false && sql.trim().length > 0,
    refetchInterval: refetch,
    staleTime: Math.floor(refetch * 0.8),
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/metrics/pg", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ sql }),
        signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`pg ${res.status} ${text.slice(0, 80)}`);
      }
      const data = (await res.json()) as PgResult;
      return data;
    },
  });
}
