// LogsTab — Loki-driven log explorer.
//
// Behavior:
//   Source picker  — multi-select dropdown populated from labels in the
//                    current Loki buffer; filters client-side.
//   Severity pills — pure client-side filter over the in-memory buffer; does
//                    NOT trigger a Loki re-query.
//   Search input   — debounced 250ms before kicking off a new Loki query.
//   Live tail      — first page (100 lines) refetched every 10s; older pages
//                    are auto-loaded via IntersectionObserver when the user
//                    scrolls near the bottom of the list.
//   Buffer cap     — 1000 entries (oldest dropped beyond that).
//   Virtualization — manual top/bottom slice driven by scrollTop + container
//                    height; row height is uniform-enough that a single
//                    ROW_HEIGHT estimate suffices. No external library.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useRangeContext } from "../data/RangeContext.tsx";
import { usePagedLokiQuery } from "../widgets/useNativeData.ts";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { StatusPill, type PillState } from "../widgets/StatusPill.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";
import { formatRelativeTime } from "../data/format.ts";
import { displaySourceLabel, displayStatusLabel } from "../data/display.ts";
import {
  buildLogql,
  buildSourceOptions,
  filterBySelectedSources,
  logSourceFor,
} from "./LogsTab.logic.ts";
import "./LogsTab.css";

type Severity = "all" | "info" | "warn" | "error";
const SEVERITIES: readonly Severity[] = ["all", "info", "warn", "error"] as const;

const PAGE_SIZE = 100;
const MAX_BUFFER = 1000;
const REFRESH_MS = 10_000;
const SEARCH_DEBOUNCE_MS = 250;
const PILL_LOCK_MS = 200;
const ROW_HEIGHT = 32; // estimated px per row; used for virtualization slice
const VIEWPORT_OVERSCAN = 6;
const LOAD_OLDER_THRESHOLD_PX = 120;

function severityFor(line: string): Severity {
  if (/\b(error|fail|panic|fatal|crit)/i.test(line)) return "error";
  if (/\b(warn|warning)/i.test(line)) return "warn";
  return "info";
}

function pillStateFor(sev: Severity): PillState {
  switch (sev) {
    case "error":
      return "alert";
    case "warn":
      return "warn";
    case "info":
      return "info";
    default:
      return "info";
  }
}

/** Debounce primitive: returns a value that lags the input by `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return out;
}

export function LogsTab() {
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [severity, setSeverity] = useState<Severity>("all");
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounced(searchInput, SEARCH_DEBOUNCE_MS);

  // Rate-limit severity pill clicks so a rapid-fire mash doesn't cause noisy
  // local re-renders while the log stream is updating.
  const [pillsLocked, setPillsLocked] = useState(false);
  const lockPills = useCallback(() => {
    setPillsLocked(true);
    window.setTimeout(() => setPillsLocked(false), PILL_LOCK_MS);
  }, []);

  // LogQL kept minimal — source + severity are client-side filters so we can
  // preserve the current-source option list and avoid re-query churn.
  const logql = useMemo(() => buildLogql(debouncedSearch), [debouncedSearch]);

  const rangeCtx = useRangeContext();
  const startNs = rangeCtx.window.startSec * 1e9;
  const endNs = rangeCtx.window.endSec * 1e9;

  const paged = usePagedLokiQuery(logql, {
    startNs,
    endNs,
    pageSize: PAGE_SIZE,
    maxBuffer: MAX_BUFFER,
    refetchMs: REFRESH_MS,
  });

  const sourceOptions = useMemo(() => buildSourceOptions(paged.entries), [paged.entries]);
  const selectedSourceSet = useMemo(() => new Set(selectedSources), [selectedSources]);
  const sourceFilteredEntries = useMemo(
    () => filterBySelectedSources(paged.entries, selectedSourceSet),
    [paged.entries, selectedSourceSet],
  );

  // Annotate entries with severity once for cheap client-side filtering.
  const annotated = useMemo(
    () => sourceFilteredEntries.map((e) => ({ entry: e, sev: severityFor(e.line) })),
    [sourceFilteredEntries],
  );
  const visibleEntries = useMemo(() => {
    if (severity === "all") return annotated;
    return annotated.filter((a) => a.sev === severity);
  }, [annotated, severity]);

  // ── Virtualization (manual windowing) ──
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(480);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight || 480);
    measure();
    const ro = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const handleScroll = useCallback(
    (ev: React.UIEvent<HTMLDivElement>) => {
      const el = ev.currentTarget;
      setScrollTop(el.scrollTop);
      // Auto-load older when scrolled within LOAD_OLDER_THRESHOLD_PX of bottom.
      const distFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (distFromBottom < LOAD_OLDER_THRESHOLD_PX && paged.hasMore && !paged.isFetching) {
        paged.loadOlder();
      }
    },
    [paged],
  );

  const total = visibleEntries.length;
  const totalHeight = total * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIEWPORT_OVERSCAN);
  const endIdx = Math.min(
    total,
    Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + VIEWPORT_OVERSCAN,
  );
  const topPadding = startIdx * ROW_HEIGHT;
  const bottomPadding = Math.max(0, totalHeight - endIdx * ROW_HEIGHT);
  const slice = visibleEntries.slice(startIdx, endIdx);

  // Reset scroll to top whenever the LogQL changes (new query → new buffer).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [logql]);

  const resetFilters = useCallback(() => {
    setSearchInput("");
    setSeverity("all");
    setSelectedSources([]);
  }, []);

  const toggleSource = useCallback((source: string) => {
    setSelectedSources((prev) =>
      prev.includes(source) ? prev.filter((item) => item !== source) : [...prev, source].sort(),
    );
  }, []);

  // The progress bar shows while a Loki fetch is in flight OR while the
  // debounce timer is pending (search input differs from its debounced
  // value).
  const debouncePending = searchInput !== debouncedSearch;
  const progressVisible = paged.isFetching || debouncePending;

  return (
    <>
      <section className="logs-controls" aria-label="Log filters">
        <div className="logs-pickers">
          <div className="logs-picker-grp" aria-label="Log source filter">
            <span className="logs-picker-lbl">Show service</span>
            <details className="logs-source-select">
              <summary className="logs-source-summary">
                {selectedSources.length === 0
                  ? `All services (${sourceOptions.length})`
                  : `${selectedSources.length} services selected`}
              </summary>
              <div className="logs-source-menu" role="group" aria-label="Service filters">
                {sourceOptions.length === 0 ? (
                  <span className="logs-source-empty">waiting for logs…</span>
                ) : (
                  sourceOptions.map((sourceName) => (
                    <label key={sourceName} className="logs-source-option">
                      <input
                        type="checkbox"
                        checked={selectedSourceSet.has(sourceName)}
                        onChange={() => toggleSource(sourceName)}
                      />
                      <span>{displaySourceLabel(sourceName)}</span>
                    </label>
                  ))
                )}
                <button
                  type="button"
                  className="logs-source-clear"
                  disabled={selectedSources.length === 0}
                  onClick={() => setSelectedSources([])}
                >
                  Show all services
                </button>
              </div>
            </details>
          </div>
          <div className="logs-picker-grp" role="group" aria-label="Severity">
            <span className="logs-picker-lbl">Severity</span>
            <div className="logs-pills">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`logs-pill logs-pill-sev-${s}${s === severity ? " is-on" : ""}`}
                  disabled={pillsLocked}
                  onClick={() => {
                    if (pillsLocked || s === severity) return;
                    lockPills();
                    setSeverity(s);
                  }}
                >
                  {displayStatusLabel(s)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <input
          type="search"
          placeholder="Filter (|~)…"
          className="logs-search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Filter log lines"
        />
      </section>

      <WidgetCard
        title="Live tail"
        source={`log search · ${visibleEntries.length}/${paged.entries.length}`}
        kind="list"
        flush
        loading={false}
        error={paged.error ? `loki error: ${paged.error.message}` : null}
        footer={
          <div className="logs-foot">
            <button
              type="button"
              className="logs-foot-btn"
              onClick={paged.refresh}
              disabled={paged.isFetching}
            >
              {paged.isFetching ? "Loading…" : "Refresh"}
            </button>
            <span className="logs-foot-meta">
              {paged.hasMore ? "Scroll for older logs" : "End of selected window"}
            </span>
          </div>
        }
      >
        <div className="logs-card-body">
          <div
            className={`logs-progress${progressVisible ? " is-on" : ""}`}
            role="progressbar"
            aria-hidden={!progressVisible}
          />
          {paged.isPending && paged.entries.length === 0 ? (
            <div className="logs-loading">
              <span className="logs-loading-dot" />
              <span className="logs-loading-dot" />
              <span className="logs-loading-dot" />
              <span className="logs-loading-txt">Querying Loki…</span>
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="logs-empty">
              <EmptyState
                icon="search"
                title="No logs match these filters"
                body={`query: ${logql}`}
                action={
                  <button type="button" className="logs-reset-btn" onClick={resetFilters}>
                    Reset filters
                  </button>
                }
              />
            </div>
          ) : (
            <div
              className="logs-stream-scroll"
              ref={scrollRef}
              onScroll={handleScroll}
              role="log"
              aria-live="polite"
            >
              <div style={{ height: totalHeight }} className="logs-stream-spacer">
                <div style={{ paddingTop: topPadding, paddingBottom: bottomPadding }}>
                  <ol className="logs-stream">
                    {slice.map(({ entry, sev }) => {
                      const sourceName = logSourceFor(entry.labels);
                      return (
                        <li
                          key={`${entry.ts}-${sourceName}-${entry.line.slice(0, 24)}`}
                          className={`logs-line logs-line-${sev}`}
                          style={{ height: ROW_HEIGHT }}
                        >
                          <span className="logs-ts">{formatRelativeTime(entry.ts)}</span>
                          <StatusPill state={pillStateFor(sev)} label={sev} />
                          <span className="logs-job">{displaySourceLabel(sourceName)}</span>
                          <span className="logs-text">{entry.line}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
              {paged.isFetching && paged.entries.length > 0 ? (
                <div className="logs-loading-more" aria-live="polite">
                  Loading older logs…
                </div>
              ) : !paged.hasMore && paged.entries.length > 0 ? (
                <div className="logs-end" aria-live="polite">
                  End of selected window
                </div>
              ) : null}
            </div>
          )}
        </div>
      </WidgetCard>
    </>
  );
}
