// LogViewer — compact real-time stream viewer for the server tab.
//
// Uses the same direct EventSource pattern as the v2 ticker: attach to
// /api/stream, normalize the wire events into a bounded in-memory log, and
// close the stream on unmount. The shared SseProvider handles cache invalidation;
// this widget keeps its own tail so operators can see what the stream is doing.

import { useCallback, useEffect, useMemo, useState } from "react";

import { formatRelativeTime } from "../data/format.ts";
import { StatusPill, type PillState } from "./StatusPill.tsx";
import { WidgetCard } from "./WidgetCard.tsx";
import "./LogViewer.css";

type StreamState = "connecting" | "live" | "reconnecting" | "closed";
type LogLevel = "info" | "warn" | "critical";

type StreamLogEntry = {
  id: string;
  ts: number;
  event: string;
  title: string;
  detail?: string;
  level: LogLevel;
};

type AlertPayload = {
  id?: string;
  severity?: string;
  kind?: string;
  title?: string;
  detail?: string;
  sinceMs?: number;
};

type HeartbeatPayload = {
  agentName?: string;
  status?: string;
  lastHeartbeatAt?: number | string;
};

type CostPayload = {
  mtdDollars?: number;
  todayDollars?: number;
  budgetPct?: number;
};

const MAX_LINES = 80;
const INITIAL_ENTRIES: StreamLogEntry[] = [
  {
    id: "seed:waiting",
    ts: Date.now(),
    event: "stream.open",
    title: "Opening live stream…",
    detail: "Waiting for /api/stream events",
    level: "info",
  },
];

function parseJson<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function levelForSeverity(severity: string | undefined): LogLevel {
  if (severity === "critical") return "critical";
  if (severity === "warn" || severity === "warning") return "warn";
  return "info";
}

function pillForState(state: StreamState): { state: PillState; label: string } {
  switch (state) {
    case "live":
      return { state: "ok", label: "live" };
    case "reconnecting":
      return { state: "warn", label: "reconnecting" };
    case "closed":
      return { state: "warn", label: "closed" };
    default:
      return { state: "info", label: "connecting" };
  }
}

function pillForLevel(level: LogLevel): PillState {
  switch (level) {
    case "critical":
      return "alert";
    case "warn":
      return "warn";
    default:
      return "info";
  }
}

function isMemoryAlert(payload: AlertPayload): boolean {
  return payload.id === "resource:mem:critical" || /memory/i.test(payload.title ?? "");
}

function describeCost(payload: CostPayload): string {
  const today = typeof payload.todayDollars === "number" ? `$${payload.todayDollars.toFixed(2)} today` : "today —";
  const mtd = typeof payload.mtdDollars === "number" ? `$${payload.mtdDollars.toFixed(2)} MTD` : "MTD —";
  const budget = typeof payload.budgetPct === "number" ? `${payload.budgetPct.toFixed(0)}% budget` : "budget —";
  return `${today} · ${mtd} · ${budget}`;
}

export function LogViewer() {
  const [entries, setEntries] = useState<StreamLogEntry[]>(INITIAL_ENTRIES);
  const [state, setState] = useState<StreamState>("connecting");

  const push = useCallback((entry: Omit<StreamLogEntry, "id"> & { id?: string }) => {
    const id = entry.id ?? `${entry.event}:${entry.ts}:${Math.random().toString(36).slice(2, 8)}`;
    setEntries((prev) => [{ ...entry, id }, ...prev].slice(0, MAX_LINES));
  }, []);

  useEffect(() => {
    setState("connecting");
    const es = new EventSource("/api/stream", { withCredentials: true });

    es.addEventListener("hello", (evt) => {
      setState("live");
      const msg = evt as MessageEvent<string>;
      const payload = parseJson<{ id?: number; ts?: number }>(msg.data);
      push({
        id: `hello:${payload?.id ?? Date.now()}`,
        ts: payload?.ts ?? Date.now(),
        event: "hello",
        title: "Stream connected",
        detail: payload?.id != null ? `subscriber ${payload.id}` : "subscriber attached",
        level: "info",
      });
    });

    es.addEventListener("alert.created", (evt) => {
      const msg = evt as MessageEvent<string>;
      const payload = parseJson<AlertPayload>(msg.data);
      if (!payload) return;
      const memoryAlert = isMemoryAlert(payload);
      push({
        id: `alert:${payload.id ?? Date.now()}:created`,
        ts: payload.sinceMs ?? Date.now(),
        event: memoryAlert ? "memory.alert" : "alert.created",
        title: payload.title ?? "Alert created",
        detail: payload.detail ?? payload.kind ?? undefined,
        level: memoryAlert ? "critical" : levelForSeverity(payload.severity),
      });
    });

    es.addEventListener("alert.resolved", (evt) => {
      const msg = evt as MessageEvent<string>;
      const payload = parseJson<{ id?: string }>(msg.data);
      const memoryAlert = payload?.id === "resource:mem:critical";
      push({
        id: `alert:${payload?.id ?? Date.now()}:resolved`,
        ts: Date.now(),
        event: memoryAlert ? "memory.recovered" : "alert.resolved",
        title: memoryAlert ? "Memory alert recovered" : "Alert resolved",
        detail: payload?.id,
        level: "info",
      });
    });

    es.addEventListener("heartbeat", (evt) => {
      const msg = evt as MessageEvent<string>;
      const payload = parseJson<HeartbeatPayload>(msg.data);
      if (!payload) return;
      push({
        id: `heartbeat:${payload.agentName ?? "agent"}:${payload.lastHeartbeatAt ?? Date.now()}`,
        ts: Date.now(),
        event: "heartbeat",
        title: `${payload.agentName ?? "Agent"} heartbeat`,
        detail: payload.status ?? "status updated",
        level: payload.status === "stale" || payload.status === "down" ? "warn" : "info",
      });
    });

    es.addEventListener("cost.tick", (evt) => {
      const msg = evt as MessageEvent<string>;
      const payload = parseJson<CostPayload>(msg.data);
      if (!payload) return;
      push({
        id: `cost:${Date.now()}`,
        ts: Date.now(),
        event: "cost.tick",
        title: "Cost pulse",
        detail: describeCost(payload),
        level: typeof payload.budgetPct === "number" && payload.budgetPct >= 90 ? "warn" : "info",
      });
    });

    es.onerror = () => {
      setState("reconnecting");
      push({
        ts: Date.now(),
        event: "stream.error",
        title: "Stream reconnecting",
        detail: "EventSource will retry automatically",
        level: "warn",
      });
    };

    return () => {
      setState("closed");
      es.close();
    };
  }, [push]);

  const status = pillForState(state);
  const memoryAlertOpen = useMemo(
    () => entries.find((entry) => entry.event === "memory.alert" || entry.event === "memory.recovered")?.event === "memory.alert",
    [entries],
  );

  return (
    <WidgetCard
      title="Real-time stream"
      source={`${entries.length} buffered events`}
      badge={<StatusPill state={status.state} label={status.label} />}
      footer={memoryAlertOpen ? "Memory alert open" : "Listening for memory alerts"}
      flush
    >
      <div className="lv" role="log" aria-live="polite" aria-label="Real-time server event log">
        {entries.map((entry) => (
          <article className={`lv-row lv-row-${entry.level}`} key={entry.id}>
            <time className="lv-ts" dateTime={new Date(entry.ts).toISOString()}>
              {formatRelativeTime(entry.ts)}
            </time>
            <StatusPill state={pillForLevel(entry.level)} label={entry.event} />
            <div className="lv-copy">
              <span className="lv-title">{entry.title}</span>
              {entry.detail ? <span className="lv-detail">{entry.detail}</span> : null}
            </div>
          </article>
        ))}
      </div>
    </WidgetCard>
  );
}
