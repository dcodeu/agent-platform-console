// IMessageTab — Sendblue / iMessage view.
//
// Pulse: gateway pill + 24h counts + failed.
// Send rate: hourly mini bars from heavy.imessage.recent[].
// Recent messages: 20 most recent with direction arrow, status pill,
// relative time, truncated text.

import { useMemo, useState } from "react";

import { useHeavy } from "../data/queries.ts";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { NativeStat } from "../widgets/NativeStat.tsx";
import { MiniBars } from "../widgets/MiniBars.tsx";
import { StatusPill, type PillState } from "../widgets/StatusPill.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";
import { formatRelativeTime } from "../data/format.ts";
import { displayStatusLabel } from "../data/display.ts";
import "./IMessageTab.css";

function statusToPill(status: string): PillState {
  switch (status) {
    case "delivered":
    case "sent":
    case "read":
      return "ok";
    case "received":
      return "info";
    case "failed":
      return "alert";
    default:
      return "idle";
  }
}

type DirFilter = "all" | "in" | "out";

export function IMessageTab() {
  const heavy = useHeavy();
  const loading = heavy.isPending;
  const data = heavy.data;
  const ime = data?.imessage;

  const [dirFilter, setDirFilter] = useState<DirFilter>("all");
  const [search, setSearch] = useState("");
  const [showFailedOnly, setShowFailedOnly] = useState(false);

  const filteredRecent = useMemo(() => {
    const rows = ime?.recent ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (dirFilter !== "all" && m.direction !== dirFilter) return false;
      if (showFailedOnly && m.status !== "failed") return false;
      if (q.length > 0) {
        const hay = `${m.text} ${m.from ?? ""} ${m.to ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [ime?.recent, dirFilter, search, showFailedOnly]);

  const platforms = data?.hermes.status?.gateway_platforms ?? {};
  const imePlatform = platforms.imessage ?? platforms.iMessage ?? platforms.sendblue ?? null;
  const connected = imePlatform?.connected === true;
  const gatewayState: PillState = connected
    ? "ok"
    : data?.hermes.status?.gateway_running
    ? "idle"
    : "alert";
  const gatewayLabel = connected ? "Connected" : data?.hermes.status?.gateway_running ? "Idle" : "Down";

  // Hourly histogram from recent events (last 24 hours, 24 buckets).
  // Respects the direction filter so the chart reshapes when filtering.
  const sendBars = useMemo(() => {
    const buckets = new Array<number>(24).fill(0);
    const now = Date.now();
    const wantOut = dirFilter !== "in";
    const wantIn = dirFilter !== "out";
    for (const m of ime?.recent ?? []) {
      if (m.direction === "out" && !wantOut) continue;
      if (m.direction === "in" && !wantIn) continue;
      const t = Date.parse(m.at);
      if (!Number.isFinite(t)) continue;
      const ageH = Math.floor((now - t) / (60 * 60 * 1000));
      if (ageH < 0 || ageH >= 24) continue;
      buckets[23 - ageH] += 1;
    }
    return buckets;
  }, [ime?.recent, dirFilter]);

  return (
    <>
      <section className="im-pulse" aria-label="iMessage pulse">
        <WidgetCard title="Gateway" source="Gateway · live" loading={loading}>
          <div className="im-gw">
            <StatusPill state={gatewayState} label={gatewayLabel} pulse={connected} />
            <div className="im-gw-sub">
              {imePlatform?.users != null ? <>{imePlatform.users} users</> : "no platform"}
            </div>
            <div className="im-gw-last">
              {imePlatform?.last_message_at
                ? `last ${formatRelativeTime(imePlatform.last_message_at)}`
                : ime?.lastOutboundAt
                ? `last out ${formatRelativeTime(ime.lastOutboundAt)}`
                : "no recent activity"}
            </div>
          </div>
        </WidgetCard>
        <NativeStat
          title="Messages received in the last 24 hours"
          value={String(ime?.last24h.in ?? 0)}
          source="Message store · 24h"
          sub={
            ime?.lastInboundAt
              ? `last ${formatRelativeTime(ime.lastInboundAt)}`
              : "inbound not yet wired"
          }
          loading={loading}
        />
        <NativeStat
          title="Messages sent in the last 24 hours"
          value={String(ime?.last24h.out ?? 0)}
          source="Message store · 24h"
          sub={ime?.lastOutboundAt ? `last ${formatRelativeTime(ime.lastOutboundAt)}` : "—"}
          loading={loading}
        />
        <NativeStat
          title="Messages failed in the last 24 hours"
          value={String(ime?.last24h.failed ?? 0)}
          source="Message store · 24h"
          sub={(ime?.last24h.failed ?? 0) === 0 ? "clean" : "see failures"}
          delta={
            (ime?.last24h.failed ?? 0) > 0
              ? { value: ime?.last24h.failed ?? 0, positive: false, label: "errors" }
              : { value: 0, positive: true, label: "ok" }
          }
          loading={loading}
        />
      </section>

      <section className="im-rate" aria-label="Send rate">
        <WidgetCard
          title="Hourly send rate"
          source="recent message history"
          loading={loading}
          footer={
            <>
              <span>buckets: 24</span>
              <span>peak {Math.max(...sendBars, 0)}</span>
            </>
          }
        >
          <MiniBars
            bars={sendBars}
            height={56}
            ariaLabel="Hourly outbound send count"
            titleFor={(v, i) => `${v} sends in hour -${23 - i}`}
          />
        </WidgetCard>
      </section>

      <section className="im-filters" aria-label="Message filters">
        <div className="im-fgrp" role="group" aria-label="Direction">
          <span className="im-flbl">Direction</span>
          <div className="im-pills">
            {(["all", "in", "out"] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`im-pill${d === dirFilter ? " is-on" : ""}`}
                onClick={() => setDirFilter(d)}
              >
                {d === "in" ? "Inbound" : d === "out" ? "Outbound" : "All"}
              </button>
            ))}
          </div>
        </div>
        <div className="im-fgrp" role="group" aria-label="Failed only">
          <span className="im-flbl">Only</span>
          <div className="im-pills">
            <button
              type="button"
              className={`im-pill${showFailedOnly ? " is-on im-pill-fail" : ""}`}
              onClick={() => setShowFailedOnly((v) => !v)}
            >
              Failed only
            </button>
          </div>
        </div>
        <input
          type="search"
          placeholder="Search text or party…"
          className="im-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search messages"
        />
      </section>

      <section aria-label="Recent messages">
        <WidgetCard title={`Recent messages${dirFilter === "all" ? "" : ` · ${dirFilter === "in" ? "received" : "sent"}`}`} source={`message history · ${filteredRecent.length}/${ime?.recent.length ?? 0}`} loading={loading} flush>
          {filteredRecent.length === 0 ? (
            <EmptyState
              icon="mail"
              title={(ime?.recent ?? []).length === 0 ? "No messages yet" : "No messages match"}
              body={ime?.note ?? "Loosen the filters or wait for new traffic."}
            />
          ) : (
            <ol className="im-list">
              {filteredRecent.slice(0, 20).map((m) => {
                const inbound = m.direction === "in";
                return (
                  <li key={m.id} className={`im-row ${inbound ? "is-in" : "is-out"}`}>
                    <span className="im-dir" aria-label={inbound ? "inbound" : "outbound"}>
                      {inbound ? "←" : "→"}
                    </span>
                    <span className="im-party">{inbound ? m.from : m.to}</span>
                    <StatusPill state={statusToPill(m.status)} label={displayStatusLabel(m.status)} />
                    <span className="im-ts">{formatRelativeTime(m.at)}</span>
                    <span className="im-text" title={m.text}>
                      {m.text.length > 200 ? `${m.text.slice(0, 200)}…` : m.text}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </WidgetCard>
      </section>

      {(ime?.last24h.in ?? 0) === 0 && ime?.note ? (
        <section aria-label="Inbound note">
          <WidgetCard title="Inbound logging" source="NOTE" loading={false}>
            <div className="im-note">
              {ime.note}
            </div>
          </WidgetCard>
        </section>
      ) : null}
    </>
  );
}
