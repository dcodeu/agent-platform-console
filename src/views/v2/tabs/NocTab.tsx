// NocTab — sci-fi network operations control deck.
//
// The VPS sits at the center as the command hub. Hermes, Paperclip, and the
// agent pool connect over animated SVG paths; host CPU/RAM drive the canvas
// oscilloscope so the deck stays grounded in live telemetry instead of pure
// theater. Elegant theater, but still telemetry.

import { useMemo } from "react";

import { useHeavy, useSnapshot } from "../data/queries.ts";
import { formatRelativeTime } from "../data/format.ts";
import { StatusPill, type PillState } from "../widgets/StatusPill.tsx";
import { Oscilloscope } from "../widgets/Oscilloscope.tsx";
import "./NocTab.css";

type NodeState = "online" | "syncing" | "warning" | "sealed";

interface GridNode {
  id: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  state: NodeState;
  metric: string;
}

function pct(used: number | null | undefined, total: number | null | undefined): number | null {
  if (!used || !total) return null;
  const out = (used / total) * 100;
  return Number.isFinite(out) ? Math.max(0, Math.min(100, out)) : null;
}

function fmtPct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(0)}%`;
}

function pillForState(state: NodeState): PillState {
  if (state === "online" || state === "sealed") return "ok";
  if (state === "warning") return "warn";
  return "info";
}

function unitState(value: string | undefined): NodeState {
  if (value === "active") return "online";
  if (value === "failed") return "warning";
  return "syncing";
}

export function NocTab() {
  const snapshot = useSnapshot();
  const heavy = useHeavy();
  const local = snapshot.data?.local;
  const history = snapshot.data?.localHistory;
  const hermes = snapshot.data?.agents.hermes;
  const paperclip = snapshot.data?.agents.paperclip;
  const pool = snapshot.data?.agents.codexPool ?? [];
  const upstream = heavy.data?.upstream ?? snapshot.data?.upstream ?? [];

  const cpuPct = local?.cpuPct ?? null;
  const ramPct = local ? pct(local.memUsedBytes, local.memTotalBytes) : null;
  const diskPct = local ? pct(local.diskRootUsedBytes, local.diskRootTotalBytes) : null;
  const readyAgents = pool.filter((w) => w.enabled && w.authState === "valid").length;
  const sealedAgents = pool.filter((w) => w.enabled && w.authState !== "quarantined").length;
  const upLinks = upstream.filter((u) => u.ok).length;
  const allLinks = upstream.length;
  const generatedAgo = snapshot.data?.generatedAt ? formatRelativeTime(snapshot.data.generatedAt) : "waiting for carrier";

  const nodes: GridNode[] = useMemo(() => {
    const hermesState = hermes?.installed ? unitState(hermes.dashboardUnitActive) : "warning";
    const paperclipState = paperclip?.installed ? unitState(paperclip.unitActive) : "warning";
    const agentState = pool.length === 0 ? "syncing" : readyAgents === 0 ? "warning" : "online";
    const monitorState = allLinks === 0 ? "syncing" : upLinks === allLinks ? "sealed" : "warning";

    return [
      {
        id: "hermes",
        label: "Hermes",
        sub: hermes?.dashboardUnitActive ?? "unknown",
        x: 18,
        y: 28,
        state: hermesState,
        metric: `${hermes?.schedules.length ?? 0} schedules`,
      },
      {
        id: "agents",
        label: "Agents",
        sub: `${readyAgents}/${pool.length || "—"} ready`,
        x: 82,
        y: 24,
        state: agentState,
        metric: `${sealedAgents} sealed`,
      },
      {
        id: "paperclip",
        label: "Paperclip",
        sub: paperclip?.unitActive ?? "unknown",
        x: 20,
        y: 76,
        state: paperclipState,
        metric: `${paperclip?.recentRuns.length ?? 0} runs`,
      },
      {
        id: "monitors",
        label: "Monitor Mesh",
        sub: allLinks ? `${upLinks}/${allLinks} links up` : "discovering",
        x: 80,
        y: 74,
        state: monitorState,
        metric: monitorState === "sealed" ? "encrypted" : "attention",
      },
    ];
  }, [allLinks, hermes, paperclip, pool.length, readyAgents, sealedAgents, upLinks]);

  const hubState: NodeState = diskPct != null && diskPct > 85 ? "warning" : "sealed";
  const telemetry = [
    { label: "CPU frequency", value: fmtPct(cpuPct), sub: "scope carrier" },
    { label: "RAM amplitude", value: fmtPct(ramPct), sub: "signal gain" },
    { label: "Root disk", value: fmtPct(diskPct), sub: hubState === "warning" ? "capacity warning" : "nominal" },
    { label: "Snapshot", value: generatedAgo, sub: "last packet" },
  ];

  return (
    <section className="noc-deck" aria-label="Network Operations Center">
      <div className="noc-hero">
        <div className="noc-title-block">
          <span className="noc-kicker">NOC // COMMAND DECK</span>
          <h2>Network Operations Center</h2>
          <p>
            Live VPS telemetry, agent mesh state, and encrypted service links in one high-contrast control surface.
          </p>
        </div>
        <div className="noc-terminal" aria-label="NOC terminal overlays">
          <span className="noc-glitch" data-text="SYNCING...">SYNCING...</span>
          <span className="noc-glitch noc-glitch-alt" data-text="SYSTEM_ENCRYPTED">SYSTEM_ENCRYPTED</span>
          <span>carrier: {local?.hostname ?? "vps-hub"}</span>
        </div>
      </div>

      <div className="noc-main-grid">
        <div className="noc-panel noc-scope-panel">
          <div className="noc-panel-head">
            <div>
              <span className="noc-eyebrow">OSCILLOSCOPE</span>
              <h3>Host signal</h3>
            </div>
            <StatusPill state={snapshot.isPending ? "info" : "ok"} label={snapshot.isPending ? "locking" : "live"} />
          </div>
          <Oscilloscope
            cpuPct={cpuPct}
            ramPct={ramPct}
            cpuHistory={history?.cpu ?? []}
            ramHistory={history?.mem ?? []}
            height={280}
          />
          <div className="noc-telemetry-strip">
            {telemetry.map((item) => (
              <div key={item.label} className="noc-telemetry-cell">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.sub}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="noc-panel noc-grid-panel">
          <div className="noc-panel-head">
            <div>
              <span className="noc-eyebrow">CONNECTION GRID</span>
              <h3>Cybernetic mesh</h3>
            </div>
            <StatusPill state={pillForState(hubState)} label={hubState === "sealed" ? "sealed" : "warn"} />
          </div>
          <div className="noc-grid-stage">
            <svg className="noc-link-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <filter id="noc-glow">
                  <feGaussianBlur stdDeviation="1.8" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {nodes.map((node, index) => (
                <path
                  key={node.id}
                  className={`noc-link noc-link-${node.state}`}
                  d={`M 50 50 C ${50 + (node.x - 50) * 0.24} ${50}, ${node.x} ${50 + (node.y - 50) * 0.24}, ${node.x} ${node.y}`}
                  style={{ animationDelay: `${index * -0.55}s` }}
                  filter="url(#noc-glow)"
                />
              ))}
            </svg>

            <div className={`noc-hub noc-node-${hubState}`}>
              <span className="noc-hub-ring" />
              <strong>VPS HUB</strong>
              <small>{local?.hostname ?? "hawilson core"}</small>
              <em>{fmtPct(cpuPct)} cpu</em>
            </div>

            {nodes.map((node) => (
              <div
                key={node.id}
                className={`noc-node noc-node-${node.state}`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
              >
                <span className="noc-node-dot" />
                <strong>{node.label}</strong>
                <small>{node.sub}</small>
                <em>{node.metric}</em>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="noc-status-row">
        {nodes.map((node) => (
          <div key={node.id} className="noc-status-card">
            <span>{node.label}</span>
            <StatusPill state={pillForState(node.state)} label={node.state} />
            <strong>{node.metric}</strong>
            <small>{node.sub}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
