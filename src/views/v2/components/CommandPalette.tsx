// CommandPalette — global Cmd/Ctrl+K modal launcher.
//
// Sources fed into the result list:
//   - Tabs           → from tabs/tab-registry.ts. Activate → set window.location.hash
//   - Panels         → from panels/panel-registry.ts. Activate → open
//                      /grafana/d/<uid> (full dashboard, not d-solo) in a new tab.
//   - Approvals      → quick-actions for creating/viewing approvals
//   - System actions → reload, refresh, open /wall, toggle ticker, open Telegram
//   - Codex workers  → per-worker quarantine / unquarantine (11 workers, state
//                      reflected from useSnapshot() so the label tracks reality)
//
// Search relevance: query is tokenized on whitespace; each token must match
// EITHER label OR description (case-insensitive). Rows are ranked by the
// summed earliest-match index — smaller wins (earlier prefix hits first).
// Empty query falls back to the first MAX_VISIBLE results.
//
// Activation paths:
//   * Cmd/Ctrl+K toggles open
//   * Escape closes
//   * The "open-command-palette" CustomEvent (dispatched from AppShell when
//     DJ clicks the ⌘K badge in the topbar) also opens it. We never dispatch
//     this ourselves — AppShell owns that wiring.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Icon, type IconName } from "../icon-sprite.tsx";
import { TABS } from "../tabs/tab-registry.ts";
import { PANELS } from "../panels/panel-registry.ts";
import { useSnapshot } from "../data/queries.ts";
import { queryClient } from "../data/queryClient.ts";
import { displayStatusLabel } from "../data/display.ts";
import "./CommandPalette.css";

const MAX_VISIBLE = 8;
const POOL_SIZE = 11;

type ResultGroup = "Tab" | "Panel" | "Approvals" | "System" | "Codex";

interface Result {
  id: string;
  group: ResultGroup;
  label: string;
  description: string; // searchable secondary text
  hint: string;        // "↵ jump" / "↗ external" — short kbd-style hint
  icon: IconName;
  run: () => void;
}

/**
 * Tokenized fuzzy match. Returns null if any token misses both label and
 * description. Otherwise returns the score (lower = better — sum of earliest
 * indexOf across tokens, so prefix hits sort above mid-string hits).
 */
function score(query: string, label: string, description: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const l = label.toLowerCase();
  const d = description.toLowerCase();
  let total = 0;
  for (const tok of tokens) {
    const li = l.indexOf(tok);
    const di = d.indexOf(tok);
    if (li < 0 && di < 0) return null;
    // Prefer label hits (+0) over description hits (+50).
    const best = li >= 0 ? li : di + 50;
    total += best;
  }
  return total;
}

function tabResults(): Result[] {
  return TABS.map((t) => ({
    id: `tab:${t.key}`,
    group: "Tab",
    label: t.label,
    description: `Navigate to ${t.label} tab`,
    hint: "↵ jump",
    icon: t.icon,
    run: () => {
      window.location.hash = `#${t.key}`;
    },
  }));
}

function panelResults(): Result[] {
  return Object.entries(PANELS).map(([key, def]) => ({
    id: `panel:${key}`,
    group: "Panel",
    label: def.defaultTitle,
    description: "Open Grafana dashboard",
    hint: "↗ external",
    icon: "layout-dashboard" as IconName,
    run: () => {
      window.open(`/grafana/d/${def.uid}`, "_blank", "noopener");
    },
  }));
}

function approvalResults(): Result[] {
  return [
    {
      id: "approvals:open",
      group: "Approvals" as ResultGroup,
      label: "Open approvals tab",
      description: "View pending and historical approvals",
      hint: "↵ jump",
      icon: "flag" as IconName,
      run: () => {
        window.location.hash = "#approvals";
      },
    },
    {
      id: "approvals:pending",
      group: "Approvals" as ResultGroup,
      label: "Show pending approvals only",
      description: "Filter approvals to pending status",
      hint: "↵ jump",
      icon: "flag" as IconName,
      run: () => {
        window.location.hash = "#approvals?filter=pending";
      },
    },
    {
      id: "approvals:create-test",
      group: "Approvals" as ResultGroup,
      label: "Create test approval",
      description: "POST a synthetic approval into the queue",
      hint: "↵ run",
      icon: "send" as IconName,
      run: () => {
        void (async () => {
          try {
            const res = await fetch("/api/approvals", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                kind: "test",
                title: "Test approval",
                source: "palette",
              }),
            });
            if (!res.ok) {
              console.warn("[command-palette] create test approval failed", res.status);
              return;
            }
            // Refresh approvals lists so the new row appears immediately.
            queryClient.invalidateQueries({ queryKey: ["approvals", "pending"] });
            queryClient.invalidateQueries({ queryKey: ["approvals", "all"] });
          } catch (e) {
            console.error("[command-palette] create test approval error", e);
          }
        })();
      },
    },
  ];
}

function systemResults(): Result[] {
  return [
    {
      id: "system:toggle-ticker",
      group: "System" as ResultGroup,
      label: "Toggle event ticker",
      description: "Collapse or expand the right-rail ticker",
      hint: "↵ run",
      icon: "bell" as IconName,
      run: () => window.dispatchEvent(new CustomEvent("toggle-ticker")),
    },
    {
      id: "system:reload",
      group: "System" as ResultGroup,
      label: "Reload page",
      description: "Full browser reload",
      hint: "↵ run",
      icon: "refresh-cw" as IconName,
      run: () => window.location.reload(),
    },
    {
      id: "system:refresh-data",
      group: "System" as ResultGroup,
      label: "Refresh all data",
      description: "Invalidate all TanStack queries (no reload)",
      hint: "↵ run",
      icon: "refresh-cw" as IconName,
      run: () => {
        queryClient.invalidateQueries();
      },
    },
    {
      id: "system:wall",
      group: "System" as ResultGroup,
      label: "Open /wall in new tab",
      description: "Network operations centre wallboard",
      hint: "↗ external",
      icon: "trending-up" as IconName,
      run: () => window.open("/wall", "_blank", "noopener"),
    },
    {
      id: "system:telegram",
      group: "System" as ResultGroup,
      label: "Open Telegram bot chat",
      description: "@djw_hermes_bot approval gate",
      hint: "↗ external",
      icon: "message-circle" as IconName,
      run: () =>
        window.open("tg://resolve?domain=djw_hermes_bot", "_blank", "noopener"),
    },
    {
      id: "system:grafana",
      group: "System" as ResultGroup,
      label: "Open Grafana",
      description: "Grafana dashboards home",
      hint: "↗ external",
      icon: "layout-dashboard" as IconName,
      run: () => window.open("/grafana/", "_blank", "noopener"),
    },
    {
      id: "system:kuma",
      group: "System" as ResultGroup,
      label: "Open Kuma",
      description: "Uptime Kuma monitor dashboard",
      hint: "↗ external",
      icon: "radio" as IconName,
      run: () =>
        window.open("https://kuma.hawilson.xyz/", "_blank", "noopener"),
    },
  ];
}

interface CodexWorkerLite {
  id: string;
  authState: string;
}

function codexResults(pool: CodexWorkerLite[]): Result[] {
  // Build a complete 11-slot list so the palette is predictable even when
  // the snapshot hasn't loaded yet — known workers fill in their real state.
  const byId = new Map<string, CodexWorkerLite>();
  for (const w of pool) byId.set(w.id, w);
  const ids: string[] = [];
  for (let i = 1; i <= POOL_SIZE; i++) {
    ids.push(`codex-${String(i).padStart(2, "0")}`);
  }
  // Include any out-of-range workers too (e.g. codex-12 if pool grows).
  for (const w of pool) {
    if (!ids.includes(w.id)) ids.push(w.id);
  }
  ids.sort();

  const out: Result[] = [];
  for (const id of ids) {
    const w = byId.get(id);
    const quarantined = w?.authState === "quarantined";
    if (quarantined) {
      out.push({
        id: `codex:${id}:unquarantine`,
        group: "Codex" as ResultGroup,
        label: `Unquarantine ${id}`,
        description: `Restore ${id} to the codex worker pool · currently quarantined`,
        hint: "↵ run",
        icon: "refresh-cw" as IconName,
        run: () => {
          void fetch(`/api/codex/${encodeURIComponent(id)}/unquarantine`, {
            method: "POST",
            credentials: "same-origin",
          })
            .then(() => queryClient.invalidateQueries({ queryKey: ["snapshot"] }))
            .catch((e) =>
              console.error("[command-palette] unquarantine failed", id, e),
            );
        },
      });
    } else {
      const stateLabel = displayStatusLabel(w?.authState ?? "unknown").toLowerCase();
      out.push({
        id: `codex:${id}:quarantine`,
        group: "Codex" as ResultGroup,
        label: `Quarantine ${id}`,
        description: `Disable ${id} in the codex worker pool · currently ${stateLabel}`,
        hint: "↵ run",
        icon: "x-circle" as IconName,
        run: () => {
          void fetch(`/api/codex/${encodeURIComponent(id)}/quarantine`, {
            method: "POST",
            credentials: "same-origin",
          })
            .then(() => queryClient.invalidateQueries({ queryKey: ["snapshot"] }))
            .catch((e) =>
              console.error("[command-palette] quarantine failed", id, e),
            );
        },
      });
    }
  }
  return out;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  const snapshot = useSnapshot();

  // Global keyboard listener: Cmd/Ctrl+K toggles open, Esc closes.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // AppShell may dispatch this from its ⌘K badge — listen passively.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("open-command-palette", onOpen);
    return () => window.removeEventListener("open-command-palette", onOpen);
  }, []);

  // Autofocus when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const pool = useMemo<CodexWorkerLite[]>(() => {
    const raw = snapshot.data?.agents?.codexPool ?? [];
    return raw.map((w) => ({ id: w.id, authState: w.authState }));
  }, [snapshot.data]);

  const allResults = useMemo<Result[]>(() => {
    return [
      ...tabResults(),
      ...panelResults(),
      ...approvalResults(),
      ...systemResults(),
      ...codexResults(pool),
    ];
  }, [pool]);

  const filtered = useMemo<Result[]>(() => {
    if (!query.trim()) return allResults.slice(0, MAX_VISIBLE);
    return allResults
      .map((r) => ({ r, s: score(query, r.label, r.description) }))
      .filter((x): x is { r: Result; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)
      .slice(0, MAX_VISIBLE)
      .map((x) => x.r);
  }, [query, allResults]);

  // Clamp selection when filtered shrinks.
  useEffect(() => {
    if (selected >= filtered.length) {
      setSelected(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selected]);

  const activate = useCallback(
    (idx: number) => {
      const r = filtered[idx];
      if (!r) return;
      r.run();
      close();
    },
    [filtered, close],
  );

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(selected);
    }
  };

  if (!open) return null;

  return (
    <div
      className="y2-cmdk-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="y2-cmdk">
        <div className="y2-cmdk-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onInputKey}
            placeholder="Search tabs, panels, approvals, workers…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="y2-cmdk-kbd">esc</span>
        </div>

        <ul className="y2-cmdk-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="y2-cmdk-empty">No matches</li>
          ) : (
            filtered.map((r, idx) => (
              <li
                key={r.id}
                role="option"
                aria-selected={idx === selected}
                className={`y2-cmdk-row${idx === selected ? " on" : ""}`}
                onMouseEnter={() => setSelected(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  activate(idx);
                }}
              >
                <span className="y2-cmdk-icon">
                  <Icon name={r.icon} size={16} />
                </span>
                <span className="y2-cmdk-label">{r.label}</span>
                <span className="y2-cmdk-group">{r.group}</span>
                <span className="y2-cmdk-hint">{r.hint}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
