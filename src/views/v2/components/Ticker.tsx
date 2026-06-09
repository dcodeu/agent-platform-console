// Ticker — fixed right rail of the v2 cockpit at ≥1100px viewports.
//
// The rail is portaled to document.body before applying position: fixed so it
// stays viewport-anchored even if a route/container later gains transform,
// containment, or overflow rules that would otherwise capture fixed children.
//
// Hidden on mobile/tablet and on the /wall route (wall has its own ticker).
//
// Event sources, merged into one stream:
//   (a) initial seed from useAlerts() — so the rail has content on first paint
//   (b) live alert.created events    → coral / red dot, severity-driven
//   (c) cost.tick is intentionally ignored here. The ticker should not show
//       spend, pricing, budget, or placeholder usage chips.
//
// The shared SseProvider invalidates TanStack caches but doesn't expose a
// pubsub bus, so for ticker-only events we attach our own EventSource on
// /api/stream — matching the pattern used by wall/Ticker.tsx. Cheap (one
// extra long-lived TCP) and avoids touching sse.ts.
//
// Last 30 events visible; oldest fall off via slice(0, 30).
//
// Collapse: a chevron in the top-right toggles between the 320px expanded
// rail and a 36px vertical pull-tab. State persists in localStorage and is
// communicated to the main content area via a `body.ticker-collapsed` class
// so .y2-page / .y2-subnav can drop their reserved right padding.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "../icon-sprite.tsx";
import { useAlerts, type AlertItem } from "../data/queries.ts";
import { formatRelativeTime } from "../data/format.ts";
import "./Ticker.css";

const MAX_EVENTS = 30;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const HIDE_BELOW_PX = 1100;
const COLLAPSE_KEY = "ticker.collapsed";
const BODY_CLASS = "ticker-collapsed";

type Dot = "info" | "attn" | "alert";

interface TickEvent {
  id: string;
  ts: number;
  dot: Dot;
  text: string;
  sub?: string;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function useHashRoute(): string {
  const [hash, setHash] = useState<string>(() =>
    typeof window === "undefined" ? "" : window.location.hash || "",
  );
  useEffect(() => {
    const on = () => setHash(window.location.hash || "");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function alertToEvent(a: AlertItem): TickEvent {
  const dot: Dot =
    a.severity === "critical" ? "alert" : a.severity === "warn" ? "attn" : "info";
  return {
    id: `alert:${a.id}`,
    ts: a.sinceMs ?? Date.now(),
    dot,
    text: a.title,
    sub: a.detail,
  };
}

function isFresh(ev: TickEvent, now = Date.now()): boolean {
  return now - ev.ts <= MAX_EVENT_AGE_MS;
}

/** Chevron pointing right (collapse) or left (expand). Inline SVG keeps the
 *  icon sprite focused on the global icon set. */
function Chevron({ dir }: { dir: "left" | "right" }) {
  // Right-pointing → collapse to the right edge. Left-pointing → pull back open.
  const d = dir === "right" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6";
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export default function Ticker() {
  const wide = useMediaQuery(`(min-width: ${HIDE_BELOW_PX}px)`);
  const hash = useHashRoute();
  const onWall = hash === "#wall" || hash === "#/wall";

  const alerts = useAlerts();
  const [events, setEvents] = useState<TickEvent[]>([]);
  const [evPerMin, setEvPerMin] = useState(0);
  const [, setTick] = useState(0);
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());

  // Mirror collapsed state to <body> class so main content CSS can react.
  // Cleared when the ticker unmounts (mobile, wall route) so main content
  // never gets stuck with extra right padding.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!wide || onWall) {
      document.body.classList.remove(BODY_CLASS);
      return;
    }
    document.body.classList.toggle(BODY_CLASS, collapsed);
    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, [collapsed, wide, onWall]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore quota / disabled storage */
      }
      return next;
    });
  }, []);

  // Cmd-K palette dispatches `toggle-ticker` to flip the collapsed state
  // without the user reaching for the chevron. Listener is always-on so it
  // works regardless of whether the rail is currently visible.
  useEffect(() => {
    const onToggle = () => toggleCollapsed();
    window.addEventListener("toggle-ticker", onToggle);
    return () => window.removeEventListener("toggle-ticker", onToggle);
  }, [toggleCollapsed]);

  // Tick once a second so relative timestamps stay fresh.
  useEffect(() => {
    if (!wide || onWall || collapsed) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [wide, onWall, collapsed]);

  // Seed from useAlerts() — only if list is empty so live events keep winning.
  useEffect(() => {
    if (!alerts.data) return;
    const seeded = alerts.data.alerts.map(alertToEvent).filter((ev) => isFresh(ev)).slice(0, MAX_EVENTS);
    setEvents((prev) => (prev.length > 0 ? prev : seeded));
  }, [alerts.data]);

  useEffect(() => {
    if (!wide || onWall) return;

    const es = new EventSource("/api/stream", { withCredentials: true });
    const recent: number[] = [];

    function push(ev: TickEvent) {
      if (!isFresh(ev)) return;
      const now = Date.now();
      recent.push(now);
      while (recent.length > 0 && now - recent[0] > 60_000) recent.shift();
      setEvPerMin(recent.length);
      setEvents((prev) => [ev, ...prev].filter((e) => isFresh(e, now)).slice(0, MAX_EVENTS));
    }

    es.addEventListener("alert.created", (evt) => {
      const msg = evt as MessageEvent<string>;
      try {
        const a = JSON.parse(msg.data) as AlertItem;
        push(alertToEvent(a));
      } catch {
        /* ignore malformed */
      }
    });

    es.addEventListener("alert.resolved", (evt) => {
      const msg = evt as MessageEvent<string>;
      try {
        const a = JSON.parse(msg.data) as { id: string };
        setEvents((prev) => prev.filter((e) => e.id !== `alert:${a.id}`));
      } catch {
        /* ignore malformed */
      }
    });

    return () => {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    };
  }, [wide, onWall]);

  if (!wide || onWall || typeof document === "undefined") return null;

  const ticker = collapsed ? (
    <aside
      className="y2-ticker y2-ticker--collapsed"
      aria-label="Event ticker (collapsed)"
    >
      <button
        type="button"
        className="y2-ticker-expand"
        aria-label="Expand event ticker"
        aria-expanded="false"
        data-ticker-collapse-btn
        onClick={toggleCollapsed}
      >
        <Chevron dir="left" />
      </button>
      <div className="y2-ticker-rail-label" aria-hidden="true">
        <span className="y2-ticker-live-d" />
        <span>EVENT TICKER</span>
        <span className="y2-ticker-rail-count">{events.length}</span>
      </div>
    </aside>
  ) : (
    <aside className="y2-ticker" aria-label="Event ticker">
      <header className="y2-ticker-h">
        <h2 className="y2-ticker-title">
          <Icon name="bell" size={14} />
          <span>Event ticker</span>
        </h2>
        <div className="y2-ticker-meta">
          <span className="y2-ticker-live">
            <span className="y2-ticker-live-d" aria-hidden="true" />
            LIVE · live stream
          </span>
          <span className="y2-ticker-rate">{evPerMin} ev/min</span>
          <button
            type="button"
            className="y2-ticker-collapse"
            aria-label="Collapse event ticker"
            aria-expanded="true"
            data-ticker-collapse-btn
            onClick={toggleCollapsed}
          >
            <Chevron dir="right" />
          </button>
        </div>
      </header>
      <div className="y2-ticker-list" role="log" aria-live="polite">
        {events.length === 0 ? (
          <div className="y2-ticker-empty">Listening…</div>
        ) : (
          events.map((e) => (
            <div className="y2-ticker-ev" key={e.id}>
              <span className="y2-ticker-ts">{formatRelativeTime(e.ts)}</span>
              <span
                className={`y2-ticker-dot y2-ticker-dot-${e.dot}`}
                aria-hidden="true"
              />
              <div className="y2-ticker-body">
                <span className="y2-ticker-text">{e.text}</span>
                {e.sub ? <span className="y2-ticker-sub">{e.sub}</span> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );

  return createPortal(ticker, document.body);
}
