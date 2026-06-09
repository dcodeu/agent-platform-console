// ApprovalsTab — unified approvals queue + history view.
//
// Two stacked sections:
//   1. Pending  — live list, freshest at top, Approve/Deny buttons per row.
//   2. History  — paged, decided rows with channel badge (UI / Telegram /
//                  iMessage / CLI / auto-expire) and decided-at relative.
//
// Filters: status (pending | all | approved | denied | expired | cancelled)
// and a free-text source filter. Data refreshes automatically on
// approval.created / approval.decided SSE events (see data/sse.ts).

import { useEffect, useMemo, useRef, useState } from "react";

import {
  useApprovalsPending,
  useApprovalsHistory,
  postApprovalDecision,
  createApproval,
  type ApprovalRow,
  type ApprovalStatus,
  type DecidedVia,
} from "../data/queries.ts";
import { queryClient } from "../data/queryClient.ts";
import { queryKeys } from "../data/queries.ts";
import { WidgetCard } from "../widgets/WidgetCard.tsx";
import { EmptyState } from "../widgets/EmptyState.tsx";
import { StatusPill, type PillState } from "../widgets/StatusPill.tsx";
import { Icon } from "../icon-sprite.tsx";
import { formatCount, formatRelativeTime } from "../data/format.ts";
import { displayEventLabel, displayStatusLabel } from "../data/display.ts";
import {
  approvalHistoryTone,
  buildApprovalHistoryContext,
  type ApprovalHistoryTone,
} from "./approval-history-display.ts";
import "./ApprovalsTab.css";

type HistoryFilter = "all" | "approved" | "denied" | "expired" | "cancelled";

function statusToPill(s: ApprovalStatus): PillState {
  switch (s) {
    case "approved":
      return "ok";
    case "denied":
      return "alert";
    case "expired":
      return "idle";
    case "cancelled":
      return "idle";
    case "pending":
    default:
      return "info";
  }
}

function viaLabel(v: DecidedVia | null): string {
  if (!v) return "—";
  switch (v) {
    case "ui":
      return "UI";
    case "telegram":
      return "Telegram";
    case "imessage":
      return "iMessage";
    case "cli":
      return "CLI";
    case "auto-expire":
      return "Auto-expired";
  }
}

function kindColor(kind: string): string {
  switch (kind) {
    case "destructive":
      return "var(--attn)";
    case "deploy":
      return "var(--accent)";
    case "merge":
      return "var(--accent)";
    case "spend":
      return "var(--viz-dim)";
    default:
      return "var(--fg-2)";
  }
}

function historyToneClass(tone: ApprovalHistoryTone): string {
  return `apv-history-row apv-history-row-${tone}`;
}

function refreshAll() {
  queryClient.invalidateQueries({ queryKey: queryKeys.approvalsPending });
  queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll });
  queryClient.invalidateQueries({ queryKey: queryKeys.heavy });
}

const CREATE_KINDS = ["deploy", "merge", "spend", "destructive", "test", "custom"] as const;
type CreateKind = (typeof CREATE_KINDS)[number];

export function ApprovalsTab() {
  const pending = useApprovalsPending();
  const history = useApprovalsHistory(100);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [sourceFilter, setSourceFilter] = useState("");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRow | null>(null);

  const pendingRows = pending.data?.approvals ?? [];
  const allRows = history.data?.approvals ?? [];

  const filteredHistory = useMemo(() => {
    const decided = allRows.filter((r) => r.status !== "pending");
    const q = sourceFilter.trim().toLowerCase();
    return decided.filter((r) => {
      if (historyFilter !== "all" && r.status !== historyFilter) return false;
      if (q.length > 0 && !r.source.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, historyFilter, sourceFilter]);

  async function decide(
    id: string,
    action: "approve" | "deny" | "cancel",
    comment?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    setDecidingId(id);
    setErrorMsg(null);
    try {
      const actor = typeof window !== "undefined" ? window.location.host : "ui";
      const normalizedComment = comment?.trim() ? comment.trim() : undefined;
      const result = await postApprovalDecision(id, action, "ui", actor, normalizedComment);
      if (!result.ok) {
        const msg = result.error ?? "failed to decide";
        setErrorMsg(msg);
        return { ok: false, error: msg };
      }
      refreshAll();
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      return { ok: false, error: msg };
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <>
      <section className="apv-header" aria-label="Approvals actions">
        <h2 className="apv-h">Approvals</h2>
        <button
          type="button"
          className="apv-create-btn"
          onClick={() => setCreateOpen(true)}
        >
          <span className="apv-create-plus" aria-hidden="true">+</span>
          <span>Create approval</span>
        </button>
      </section>

      {createOpen ? (
        <CreateApprovalModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refreshAll();
          }}
        />
      ) : null}

      {selectedApproval ? (
        <ApprovalDetailModal
          row={selectedApproval}
          busy={decidingId === selectedApproval.id}
          onClose={() => setSelectedApproval(null)}
          onDecide={decide}
        />
      ) : null}

      <section className="apv-pulse" aria-label="Approvals pulse">
        <div className="apv-pulse-tile">
          <div className="apv-pulse-label">Pending</div>
          <div className="apv-pulse-val">{formatCount(pendingRows.length)}</div>
        </div>
        <div className="apv-pulse-tile">
          <div className="apv-pulse-label">Decided · last {allRows.length}</div>
          <div className="apv-pulse-val">
            {formatCount(allRows.filter((r) => r.status !== "pending").length)}
          </div>
        </div>
        <div className="apv-pulse-tile">
          <div className="apv-pulse-label">Approved rate</div>
          <div className="apv-pulse-val">
            {(() => {
              const decided = allRows.filter((r) => r.status !== "pending");
              if (decided.length === 0) return "—";
              const ok = decided.filter((r) => r.status === "approved").length;
              return `${Math.round((ok / decided.length) * 100)}%`;
            })()}
          </div>
        </div>
      </section>

      {errorMsg ? (
        <div className="apv-err" role="alert">
          <Icon name="x-circle" size={14} /> <span>{errorMsg}</span>
        </div>
      ) : null}

      <section className="apv-section" aria-label="Pending approvals">
        <WidgetCard
          title={`Pending · ${pendingRows.length}`}
          source="approval queue · live now"
          loading={pending.isPending}
          error={pending.error ? String(pending.error) : null}
          flush
        >
          {pendingRows.length === 0 ? (
            <EmptyState title="No pending approvals" />
          ) : (
            <table className="apv-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Title</th>
                  <th>Requester</th>
                  <th>Requested</th>
                  <th className="apv-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((r) => (
                  <ApprovalRowItem
                    key={r.id}
                    row={r}
                    onOpen={() => {
                      setErrorMsg(null);
                      setSelectedApproval(r);
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </WidgetCard>
      </section>

      <section className="apv-section" aria-label="History">
        <WidgetCard
          title={`History · ${filteredHistory.length}`}
          source="approval history · latest 100"
          loading={history.isPending}
          error={history.error ? String(history.error) : null}
          badge={
            <div className="apv-filters">
              {(
                [
                  "all",
                  "approved",
                  "denied",
                  "expired",
                  "cancelled",
                ] as HistoryFilter[]
              ).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`apv-filter${historyFilter === f ? " on" : ""}`}
                  onClick={() => setHistoryFilter(f)}
                >
                  {displayStatusLabel(f)}
                </button>
              ))}
              <input
                className="apv-source-input"
                type="text"
                placeholder="Filter by source"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              />
            </div>
          }
          flush
        >
          {filteredHistory.length === 0 ? (
            <EmptyState title="No history yet" />
          ) : (
            <table className="apv-table apv-table-history">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Request</th>
                  <th>Requester / agent</th>
                  <th>Target / action</th>
                  <th>Decision</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((r) => (
                  <ApprovalHistoryRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          )}
        </WidgetCard>
      </section>
    </>
  );
}

function ApprovalHistoryRow({ row }: { row: ApprovalRow }) {
  const context = buildApprovalHistoryContext(row);
  const tone = approvalHistoryTone(row);
  const decisionAt = row.decided_at ?? row.requested_at;
  const shortId = row.id.slice(0, 8);

  return (
    <tr className={historyToneClass(tone)}>
      <td>
        <div className="apv-history-status">
          <StatusPill state={statusToPill(row.status)} label={displayStatusLabel(row.status)} />
          {context.commentPreview ? (
            <span className="apv-comment-dot" title="Has approval comment">
              comment
            </span>
          ) : null}
        </div>
      </td>
      <td className="apv-title-cell apv-history-request">
        <div className="apv-title">{context.summary}</div>
        {context.detail ? <div className="apv-detail">{context.detail}</div> : null}
        <div className="apv-history-meta">
          <span
            className="apv-kind-chip"
            style={{ color: kindColor(row.kind) }}
          >
            {displayEventLabel(row.kind)}
          </span>
          <span className="apv-id">id {shortId}</span>
        </div>
      </td>
      <td className="apv-mono apv-history-context">{context.actorLine}</td>
      <td className="apv-mono apv-history-context">{context.targetLine}</td>
      <td className="apv-mono">
        <div>{viaLabel(row.decided_via)}</div>
        <div className="apv-history-time">{formatRelativeTime(decisionAt)}</div>
        {row.actor ? <div className="apv-history-actor">by {row.actor}</div> : null}
      </td>
      <td className="apv-comment-cell">
        {context.commentPreview ? (
          <span>{context.commentPreview}</span>
        ) : (
          <span className="apv-muted">—</span>
        )}
      </td>
    </tr>
  );
}

interface ApprovalRowItemProps {
  row: ApprovalRow;
  onOpen: () => void;
}

interface ApprovalDetailModalProps {
  row: ApprovalRow;
  busy: boolean;
  onClose: () => void;
  onDecide: (
    id: string,
    action: "approve" | "deny" | "cancel",
    comment?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

interface CreateApprovalModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateApprovalModal({ onClose, onCreated }: CreateApprovalModalProps) {
  const [kind, setKind] = useState<CreateKind>("test");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [source, setSource] = useState("manual");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!title.trim()) {
      setErr("title is required");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await createApproval({
        source: source.trim() || "manual",
        kind,
        title: title.trim(),
        detail: detail.trim() ? detail.trim() : undefined,
      });
      if (!res.ok) {
        setErr(res.error ?? "failed to create");
        return;
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="apv-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Create approval"
    >
      <div className="apv-modal">
        <div className="apv-modal-head">
          <h3>Create approval</h3>
          <button
            type="button"
            className="apv-modal-x"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x-circle" size={16} />
          </button>
        </div>
        <div className="apv-modal-body">
          <label className="apv-field">
            <span>Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CreateKind)}
            >
              {CREATE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="apv-field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Deploy hermes-gateway"
              autoFocus
            />
          </label>
          <label className="apv-field">
            <span>Detail (optional)</span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              placeholder="What needs approval, and why?"
            />
          </label>
          <label className="apv-field">
            <span>Requester</span>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          {err ? <div className="apv-modal-err">{err}</div> : null}
        </div>
        <div className="apv-modal-foot">
          <button
            type="button"
            className="apv-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="apv-btn apv-btn-approve"
            onClick={submit}
            disabled={submitting || !title.trim()}
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovalRowItem({ row, onOpen }: ApprovalRowItemProps) {
  const shortId = row.id.slice(0, 8);
  return (
    <tr
      className="apv-row-click"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td>
        <span
          className="apv-kind-chip"
          style={{ color: kindColor(row.kind) }}
        >
          {displayEventLabel(row.kind)}
        </span>
      </td>
      <td className="apv-title-cell">
        <div className="apv-title">{row.title}</div>
        {row.detail ? <div className="apv-detail">{row.detail}</div> : null}
        <div className="apv-id">id {shortId}</div>
      </td>
      <td className="apv-mono">{row.source}</td>
      <td className="apv-mono">{formatRelativeTime(row.requested_at)}</td>
      <td className="apv-actions-col">
        <div className="apv-actions">
          <button
            type="button"
            className="apv-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            <span>Review</span>
          </button>
        </div>
      </td>
    </tr>
  );
}

function ApprovalDetailModal({ row, busy, onClose, onDecide }: ApprovalDetailModalProps) {
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const shortId = row.id.slice(0, 8);
  const payloadJson = JSON.stringify(row.payload ?? {}, null, 2);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit(action: "approve" | "deny") {
    setErr(null);
    setSuccess(null);
    const result = await onDecide(row.id, action, comment);
    if (!result.ok) {
      setErr(result.error ?? "failed to submit decision");
      return;
    }
    setSuccess(`${action === "approve" ? "Approved" : "Denied"} ${shortId}. The queue and history are refreshing.`);
  }

  return (
    <div
      className="apv-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Approval ${shortId} detail`}
    >
      <div className="apv-modal apv-detail-modal">
        <div className="apv-modal-head">
          <div>
            <h3>{row.title}</h3>
            <div className="apv-detail-subhead">id {shortId} · {displayEventLabel(row.kind)}</div>
          </div>
          <button
            type="button"
            className="apv-modal-x"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="x-circle" size={16} />
          </button>
        </div>

        <div className="apv-modal-body">
          <div className="apv-detail-grid">
            <div>
              <span>Requester</span>
              <strong>{row.source}</strong>
            </div>
            <div>
              <span>Status</span>
              <StatusPill state={statusToPill(row.status)} label={displayStatusLabel(row.status)} />
            </div>
            <div>
              <span>Requested</span>
              <strong>{formatRelativeTime(row.requested_at)}</strong>
            </div>
            <div>
              <span>Expires</span>
              <strong>{row.expires_at ? formatRelativeTime(row.expires_at) : "—"}</strong>
            </div>
          </div>

          {row.detail ? (
            <section className="apv-context-block">
              <h4>Request detail</h4>
              <p>{row.detail}</p>
            </section>
          ) : null}

          <section className="apv-context-block">
            <h4>Full request context</h4>
            {payloadJson === "{}" ? (
              <p className="apv-muted">No structured payload supplied.</p>
            ) : (
              <pre>{payloadJson}</pre>
            )}
          </section>

          <label className="apv-field">
            <span>Decision comment</span>
            <textarea
              ref={commentRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              disabled={busy || success != null}
              placeholder="Optional context to attach to the approve/deny decision"
            />
          </label>

          {err ? <div className="apv-modal-err" role="alert">{err}</div> : null}
          {success ? <div className="apv-modal-ok" role="status">{success}</div> : null}
        </div>

        <div className="apv-modal-foot">
          <button type="button" className="apv-btn" onClick={onClose} disabled={busy}>
            {success ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            className="apv-btn"
            onClick={() => commentRef.current?.focus()}
            disabled={busy || success != null}
          >
            Comment
          </button>
          <button
            type="button"
            className="apv-btn apv-btn-deny"
            onClick={() => void submit("deny")}
            disabled={busy || success != null}
          >
            <Icon name="x-circle" size={14} /> <span>{busy ? "Submitting…" : "Deny"}</span>
          </button>
          <button
            type="button"
            className="apv-btn apv-btn-approve"
            onClick={() => void submit("approve")}
            disabled={busy || success != null}
          >
            <Icon name="check" size={14} /> <span>{busy ? "Submitting…" : "Approve"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
