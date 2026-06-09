// CodexWorkerDrawer — side drawer with per-worker detail + actions.
//
// Pure overlay (no portal needed for our shell). Click-out and Escape close.
// Action buttons hit the new /api/codex/:id/{quarantine,unquarantine} routes
// with credentials: 'same-origin'.

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { CodexWorker } from "../../lib/workers.ts";
import { StatusPill, type PillState } from "./widgets/StatusPill.tsx";
import { formatRelativeTime } from "./data/format.ts";
import { queryKeys } from "./data/queries.ts";
import "./CodexWorkerDrawer.css";

export interface CodexWorkerDrawerProps {
  worker: CodexWorker | null;
  onClose: () => void;
}

interface ActionState {
  pending: "quarantine" | "unquarantine" | null;
  result: string | null;
  error: string | null;
}

function authPill(worker: CodexWorker): { state: PillState; label: string } {
  if (worker.authState === "quarantined") return { state: "alert", label: "quarantined" };
  if (worker.authState === "valid" && worker.enabled) return { state: "ok", label: "ready" };
  if (worker.authState === "valid") return { state: "idle", label: "disabled" };
  return { state: "warn", label: worker.authState };
}

async function postAction(id: string, action: "quarantine" | "unquarantine"): Promise<{
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}> {
  const res = await fetch(`/api/codex/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, error: (body.error as string) ?? `HTTP ${res.status}` };
  }
  return body as { ok: boolean; exitCode?: number; stdout?: string; stderr?: string };
}

export function CodexWorkerDrawer({ worker, onClose }: CodexWorkerDrawerProps) {
  const qc = useQueryClient();
  const [action, setAction] = useState<ActionState>({ pending: null, result: null, error: null });

  useEffect(() => {
    // Reset action state on worker swap.
    setAction({ pending: null, result: null, error: null });
  }, [worker?.id]);

  useEffect(() => {
    if (!worker) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [worker, onClose]);

  const runAction = useCallback(
    async (kind: "quarantine" | "unquarantine") => {
      if (!worker) return;
      setAction({ pending: kind, result: null, error: null });
      const out = await postAction(worker.id, kind);
      if (out.ok) {
        setAction({
          pending: null,
          result: `${kind} ok (exit ${out.exitCode ?? 0})`,
          error: null,
        });
        // Bust snapshot so the drawer + grid update.
        await qc.invalidateQueries({ queryKey: queryKeys.snapshot });
      } else {
        setAction({
          pending: null,
          result: null,
          error: out.error ?? out.stderr ?? "action failed",
        });
      }
    },
    [worker, qc],
  );

  if (!worker) return null;
  const pill = authPill(worker);
  const isQuar = worker.authState === "quarantined";

  return (
    <>
      <div className="cw-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        className="cw-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Codex worker ${worker.id} detail`}
      >
        <header className="cw-head">
          <div className="cw-title">
            <span className="cw-id">{worker.id}</span>
            <StatusPill state={pill.state} label={pill.label} />
          </div>
          <button
            type="button"
            className="cw-close"
            aria-label="Close drawer"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="cw-body">
          <dl className="cw-grid">
            <div>
              <dt>Enabled</dt>
              <dd>{worker.enabled ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt>Auth state</dt>
              <dd>{worker.authState}</dd>
            </div>
            <div>
              <dt>Last used</dt>
              <dd>{worker.lastUsedAt ? formatRelativeTime(worker.lastUsedAt) : "never"}</dd>
            </div>
            <div>
              <dt>Usage · today</dt>
              <dd>{worker.usageToday}</dd>
            </div>
            <div>
              <dt>Usage · all time</dt>
              <dd>{worker.usageCount}</dd>
            </div>
          </dl>

          <section className="cw-section" aria-label="Recent tasks">
            <h4>Recent tasks</h4>
            {worker.recentTasks.length === 0 ? (
              <p className="cw-empty">No recent task records on disk.</p>
            ) : (
              <ul className="cw-tasks">
                {worker.recentTasks.map((t, i) => (
                  <li key={i} className={`cw-task${t.exit !== 0 ? " is-fail" : ""}`}>
                    <span className="cw-task-ts">{formatRelativeTime(t.ts)}</span>
                    <span className="cw-task-exit">exit {t.exit}</span>
                    {t.cmd ? <span className="cw-task-cmd">{t.cmd}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cw-section" aria-label="Actions">
            <h4>Actions</h4>
            <div className="cw-actions">
              <button
                type="button"
                className="cw-btn cw-btn-warn"
                disabled={action.pending !== null || isQuar}
                onClick={() => runAction("quarantine")}
              >
                {action.pending === "quarantine" ? "Quarantining…" : "Quarantine"}
              </button>
              <button
                type="button"
                className="cw-btn cw-btn-ok"
                disabled={action.pending !== null || !isQuar}
                onClick={() => runAction("unquarantine")}
              >
                {action.pending === "unquarantine" ? "Releasing…" : "Unquarantine"}
              </button>
            </div>
            {action.result ? <p className="cw-ok" role="status">{action.result}</p> : null}
            {action.error ? <p className="cw-err" role="alert">{action.error}</p> : null}
          </section>
        </div>
      </aside>
    </>
  );
}
