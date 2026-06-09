// ApprovalBanner — sticky coral-tinted notice when Paperclip has pending
// approvals waiting on DJ.
//
// Reads heavy.approvalsPending via useHeavy(); renders nothing when zero.
// Shows the most-recent pending approval with Approve / Reject buttons that
// POST to /api/approvals/<id>. If that endpoint isn't wired yet (404 or 405),
// we fall back to displaying the equivalent shell command DJ can paste —
// there's already an `approve <id>` / `reject <id>` CLI wrapper on the box.
//
// Per the impeccable rules: NO side-stripe, NO gradient — just a flat
// coral-tinted surface (var(--attn-surface)) with normal text color.

import { useState } from "react";

import { Icon } from "../icon-sprite.tsx";
import { useHeavy } from "../data/queries.ts";
import { queryClient } from "../data/queryClient.ts";
import { queryKeys } from "../data/queries.ts";
import { formatRelativeTime } from "../data/format.ts";
import "./ApprovalBanner.css";

interface ApprovalLike {
  id: string;
  issueId?: string;
  status: string;
  requestedAt?: string;
  requestedByAgent?: string;
  approverRequired?: string;
  title?: string;
}

type ActionState =
  | { kind: "idle" }
  | { kind: "pending"; action: "approve" | "reject" }
  | { kind: "fallback"; cmd: string }
  | { kind: "error"; message: string };

async function postApprovalDecision(
  id: string,
  action: "approve" | "reject",
): Promise<{ ok: true } | { ok: false; status: number }> {
  // Prefer the new unified endpoint (`/decide`); fall back to legacy shim if
  // the server doesn't have it wired (older console versions).
  const payload = { action: action === "reject" ? "deny" : "approve", via: "ui" as const };
  const res = await fetch(`/api/approvals/${encodeURIComponent(id)}/decide`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true };
  if (res.status === 404 || res.status === 405) {
    const legacy = await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action }),
    });
    if (legacy.ok) return { ok: true };
    return { ok: false, status: legacy.status };
  }
  return { ok: false, status: res.status };
}

export default function ApprovalBanner() {
  const heavy = useHeavy();
  const pending = (heavy.data?.approvalsPending ?? []) as ApprovalLike[];
  const [state, setState] = useState<ActionState>({ kind: "idle" });

  if (pending.length === 0) return null;

  // Most-recent pending = highest requestedAt timestamp.
  const sorted = [...pending].sort((a, b) => {
    const ta = a.requestedAt ? Date.parse(a.requestedAt) : 0;
    const tb = b.requestedAt ? Date.parse(b.requestedAt) : 0;
    return tb - ta;
  });
  const head = sorted[0];
  const more = sorted.length - 1;

  const subline = [
    head.requestedByAgent,
    head.issueId,
    head.requestedAt ? formatRelativeTime(head.requestedAt) : null,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" · ");

  async function decide(action: "approve" | "reject") {
    setState({ kind: "pending", action });
    try {
      const result = await postApprovalDecision(head.id, action);
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: queryKeys.heavy });
        queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
        setState({ kind: "idle" });
        return;
      }
      if (result.status === 404 || result.status === 405) {
        // No POST endpoint yet — show the CLI fallback.
        setState({ kind: "fallback", cmd: `${action} ${head.id}` });
        return;
      }
      setState({
        kind: "error",
        message: `Server returned ${result.status}`,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  function showMore() {
    // Stub — real modal lands later; for now dump the rest to the console
    // so DJ can see what's queued.
    console.log("[approvals] additional pending:", sorted.slice(1));
  }

  return (
    <section className="y2-approval" role="status" aria-live="polite">
      <div className="y2-approval-icon" aria-hidden="true">
        <Icon name="flag" size={20} />
      </div>

      <div className="y2-approval-text">
        <h3 className="y2-approval-h">
          {head.title
            ? `Paperclip awaits approval: ${head.title}`
            : "Paperclip awaits approval to deploy"}
        </h3>
        {subline ? <p className="y2-approval-sub">{subline}</p> : null}
        {state.kind === "fallback" ? (
          <p className="y2-approval-fallback">
            API not wired — run{" "}
            <code className="y2-approval-cmd">{state.cmd}</code> in the shell.
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p className="y2-approval-err">{state.message}</p>
        ) : null}
      </div>

      <div className="y2-approval-actions">
        {more > 0 ? (
          <button
            type="button"
            className="y2-approval-more"
            onClick={showMore}
            aria-label={`Show ${more} more pending approvals`}
          >
            +{more} more
          </button>
        ) : null}
        <button
          type="button"
          className="y2-approval-btn y2-approval-reject"
          onClick={() => decide("reject")}
          disabled={state.kind === "pending"}
        >
          <Icon name="x-circle" size={16} />
          <span>Reject</span>
        </button>
        <button
          type="button"
          className="y2-approval-btn y2-approval-approve"
          onClick={() => decide("approve")}
          disabled={state.kind === "pending"}
        >
          <Icon name="check" size={16} />
          <span>
            {state.kind === "pending" && state.action === "approve"
              ? "Approving…"
              : "Approve"}
          </span>
        </button>
      </div>
    </section>
  );
}
