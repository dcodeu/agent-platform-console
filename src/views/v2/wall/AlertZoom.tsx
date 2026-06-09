// AlertZoom — context provider that tracks which SLO tile (by PanelKey) is
// currently "zoomed". When an alert.created SSE event arrives, the affected
// service is mapped to one of the 5 SLO tiles on the wall; that tile scales
// 1.5x for 30 seconds, then snaps back.
//
// Why context (not just CSS): we want a single source of truth so siblings
// (the ticker, the header pill) can also react to the zoom state if needed
// later. Today the only consumer is the SLO tile wrapper.
//
// Mapping (Alert.kind → PanelKey) is intentionally narrow — we only zoom on
// the 5 keys that appear on the wall. Anything else is ignored (still shows
// up in the ticker).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { PanelKey } from "../panels/panel-registry.ts";
import type { Alert, AlertKind } from "../../../lib/alerts.ts";

const ZOOM_DURATION_MS = 30_000;

/** Map an alert kind to the PanelKey we want to draw attention to. */
function alertKindToPanel(kind: AlertKind): PanelKey | null {
  switch (kind) {
    case "upstream_down":
    case "gateway_down":
      return "kumaUp";
    case "stuck_agent":
    case "cron_failed":
      return "successRate24h";
    case "budget_forecast":
      // No spend tile on the wall today; closest semantic neighbour is the
      // throughput band — but the band isn't an SLO tile, so suppress.
      return null;
    case "vps_action_stuck":
      return "hostCpu";
    case "backup_stale":
    case "domain_expiring":
      return "pgCacheHit";
    case "approval_pending":
      return null;
    default:
      return null;
  }
}

interface AlertZoomContextValue {
  zoomedKey: PanelKey | null;
  /** Programmatically trigger a zoom (used by the SSE bridge). */
  triggerZoom: (key: PanelKey) => void;
}

const AlertZoomContext = createContext<AlertZoomContextValue>({
  zoomedKey: null,
  triggerZoom: () => {},
});

export interface AlertZoomProviderProps {
  /** Latest alert observed by the parent (typically the most recent
   *  alert.created event). When this changes and maps to a PanelKey we
   *  start a 30s zoom timer. */
  latestAlert: Alert | null;
  children: ReactNode;
}

export function AlertZoomProvider({ latestAlert, children }: AlertZoomProviderProps) {
  const [zoomedKey, setZoomedKey] = useState<PanelKey | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTriggeredAlertId = useRef<string | null>(null);

  const triggerZoom = useCallback((key: PanelKey) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setZoomedKey(key);
    timerRef.current = setTimeout(() => {
      setZoomedKey(null);
      timerRef.current = null;
    }, ZOOM_DURATION_MS);
  }, []);

  useEffect(() => {
    if (!latestAlert) return;
    // Don't re-trigger for the same alert id (component re-renders shouldn't
    // restart the 30s clock).
    if (lastTriggeredAlertId.current === latestAlert.id) return;
    const key = alertKindToPanel(latestAlert.kind);
    if (!key) return;
    lastTriggeredAlertId.current = latestAlert.id;
    triggerZoom(key);
  }, [latestAlert, triggerZoom]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const value = useMemo<AlertZoomContextValue>(
    () => ({ zoomedKey, triggerZoom }),
    [zoomedKey, triggerZoom],
  );

  return <AlertZoomContext.Provider value={value}>{children}</AlertZoomContext.Provider>;
}

export function useAlertZoom(): AlertZoomContextValue {
  return useContext(AlertZoomContext);
}

/** Wraps an SLO tile so it scales when its PanelKey is the zoom target. */
export function ZoomShell({ panelKey, children }: { panelKey: PanelKey; children: ReactNode }) {
  const { zoomedKey } = useAlertZoom();
  const isZoomed = zoomedKey === panelKey;
  return (
    <div className={`wall-slo-cell${isZoomed ? " is-zoomed" : ""}`}>
      {children}
    </div>
  );
}
