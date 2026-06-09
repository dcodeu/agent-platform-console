// IframePanel — embeds a single Grafana panel via the Hono /grafana/* reverse
// proxy.
//
// Auth/CSP: the proxy strips X-Frame-Options and CSP from upstream and injects
// CF Access service-token + Grafana SA token server-side. Same-origin so
// `allow-same-origin` is needed; Grafana also runs scripts so `allow-scripts`.
//
// State machine:
//   probing  — initial; HEAD-fetch the URL to check reachability before
//              committing to <iframe> render. Avoids Chrome's "happy path"
//              where it cheerfully renders the proxy's 503 JSON body in its
//              built-in JSON viewer (with a "Pretty-print" checkbox 🙃).
//   loading  — probe succeeded; iframe is mounted but not yet loaded.
//   loaded   — iframe `onLoad` fired; hide skeleton.
//   errored  — probe non-OK (e.g. 503 when Doppler secrets unconfigured),
//              probe network failure, iframe `onError`, OR 8s timeout w/o
//              onLoad. Shows graceful "Panel unavailable" + retry.
//
// Note: while the iframe is loading we mount it but keep it visually hidden so
// the skeleton stays on top. Once onLoad fires we drop the hidden class.

import { useEffect, useRef, useState } from "react";

import { Icon } from "../icon-sprite";

import "./IframePanel.css";

export type PanelVariant = "stat" | "timeseries" | "table" | "bar";

export interface IframePanelProps {
  uid: string;
  panelId: number;
  variant?: PanelVariant;
  height?: number;
  title?: string;
  /** Grafana time range start (default `now-24h`). */
  from?: string;
  /** Grafana time range end (default `now`). */
  to?: string;
}

const DEFAULT_HEIGHT_BY_VARIANT: Record<PanelVariant, number> = {
  stat: 140,
  timeseries: 240,
  table: 320,
  bar: 240,
};

const LOAD_TIMEOUT_MS = 8_000;

type PanelState = "probing" | "loading" | "loaded" | "errored";

function buildPanelUrl(
  uid: string,
  panelId: number,
  from: string,
  to: string,
  reloadToken: number,
): string {
  const params = new URLSearchParams({
    panelId: String(panelId),
    theme: "dark",
    kiosk: "tv",
    from,
    to,
  });
  if (reloadToken > 0) params.set("_r", String(reloadToken));
  return `/grafana/d-solo/${encodeURIComponent(uid)}?${params.toString()}`;
}

export function IframePanel({
  uid,
  panelId,
  variant = "stat",
  height,
  title,
  from = "now-24h",
  to = "now",
}: IframePanelProps) {
  const [state, setState] = useState<PanelState>("probing");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const timerRef = useRef<number | null>(null);

  const resolvedHeight = height ?? DEFAULT_HEIGHT_BY_VARIANT[variant];
  const src = buildPanelUrl(uid, panelId, from, to, reloadToken);

  useEffect(() => {
    let cancelled = false;
    setState("probing");
    setErrorStatus(null);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Probe the proxy with a cheap HEAD before committing to the iframe.
    // The proxy handles GET/HEAD identically and returns the same status,
    // so this is a faithful precheck without paying the body-render cost.
    fetch(src, { method: "HEAD", credentials: "same-origin" })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setErrorStatus(res.status);
          setState("errored");
          return;
        }
        // Probe OK → mount iframe and arm the load-timeout fallback in case
        // the iframe hangs after the probe.
        setState("loading");
        timerRef.current = window.setTimeout(() => {
          setState((prev) => {
            if (prev === "loading") {
              setErrorStatus(null);
              return "errored";
            }
            return prev;
          });
        }, LOAD_TIMEOUT_MS);
      })
      .catch(() => {
        if (cancelled) return;
        setErrorStatus(null);
        setState("errored");
      });

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [src]);

  const onLoad = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState("loaded");
  };

  const onError = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setErrorStatus(null);
    setState("errored");
  };

  // Re-trigger the probe (not just the iframe). Bumping reloadToken changes
  // `src`, which the useEffect above depends on.
  const refresh = () => setReloadToken((t) => t + 1);

  const heading = title ?? `${uid} · ${panelId}`;

  const showIframe = state === "loading" || state === "loaded";
  const showSkeleton = state === "probing" || state === "loading";

  return (
    <div className="y2-panel" style={{ minHeight: resolvedHeight + 41 /* header */ }}>
      <header className="y2-panel-h">
        <h3 title={heading}>{heading}</h3>
        <span className="y2-panel-src">grafana</span>
      </header>
      <div className="y2-panel-b" style={{ height: resolvedHeight }}>
        {showIframe && (
          <iframe
            key={reloadToken}
            className={`y2-panel-frame${state === "loaded" ? "" : " y2-panel-frame--hidden"}`}
            src={src}
            title={heading}
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            referrerPolicy="no-referrer"
            onLoad={onLoad}
            onError={onError}
          />
        )}
        {showSkeleton && (
          <div className="y2-panel-skel" aria-hidden="true" />
        )}
        {state === "errored" && (
          <div className="y2-panel-err" role="status">
            <Icon
              name="triangle-alert"
              size={20}
              className="y2-panel-err-icon"
              aria-label="Panel unavailable"
            />
            <div className="y2-panel-err-msg">Panel unavailable</div>
            {errorStatus !== null && (
              <div className="y2-panel-err-sub">HTTP {errorStatus}</div>
            )}
            <button
              type="button"
              className="y2-panel-refresh"
              onClick={refresh}
              aria-label="Try loading again"
            >
              <Icon name="refresh-cw" size={12} aria-label="" />
              Try loading again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
