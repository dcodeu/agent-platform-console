import type { ApprovalStatus, DecidedVia } from "../data/queries.ts";
import { displayEventLabel, displaySourceLabel } from "../data/display.ts";

export interface ApprovalHistoryRowInput {
  id: string;
  source: string;
  kind: string;
  title: string;
  detail: string | null;
  status: ApprovalStatus;
  requested_at: string;
  decided_at: string | null;
  decided_via: DecidedVia | null;
  actor: string | null;
  decision_comment?: string | null;
  payload: Record<string, unknown>;
  expires_at: string | null;
}

export type ApprovalHistoryTone =
  | "pending"
  | "approved"
  | "denied"
  | "commented"
  | "neutral";

export interface ApprovalHistoryContext {
  summary: string;
  detail: string | null;
  actorLine: string;
  targetLine: string;
  commentPreview: string | null;
}

const TRANSITION_TITLE_RE = /^(?:pending|approved|denied|expired|cancelled)\s*(?:→|->|to)\s*(?:pending|approved|denied|expired|cancelled)$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function truncate(s: string, max = 140): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function payloadScopes(row: ApprovalHistoryRowInput): Record<string, unknown>[] {
  const payload = isRecord(row.payload) ? row.payload : {};
  return [
    payload,
    isRecord(payload.request) ? payload.request : null,
    isRecord(payload.approval) ? payload.approval : null,
    isRecord(payload.request_context) ? payload.request_context : null,
    isRecord(payload.requestContext) ? payload.requestContext : null,
    isRecord(payload.metadata) ? payload.metadata : null,
    isRecord(payload.context) ? payload.context : null,
  ].filter(isRecord);
}

function firstField(scopes: Record<string, unknown>[], keys: string[]): string | null {
  for (const scope of scopes) {
    for (const key of keys) {
      const value = cleanString(scope[key]);
      if (value) return value;
    }
  }
  return null;
}

function firstComment(scopes: Record<string, unknown>[]): string | null {
  const direct = firstField(scopes, [
    "decisionNote",
    "decision_note",
    "decisionComment",
    "decision_comment",
    "commentBody",
    "comment_body",
    "commentPreview",
    "comment_preview",
    "comment",
    "note",
  ]);
  if (direct) return direct;

  for (const scope of scopes) {
    const comments = scope.comments ?? scope.approval_comments;
    if (!Array.isArray(comments)) continue;
    for (let i = comments.length - 1; i >= 0; i -= 1) {
      const item = comments[i];
      const body = isRecord(item)
        ? firstField([item], ["body", "comment", "text", "message"])
        : cleanString(item);
      if (body) return body;
    }
  }
  return null;
}

function titleIsOnlyTransition(title: string): boolean {
  return TRANSITION_TITLE_RE.test(title.trim());
}

export function previewApprovalComment(row: ApprovalHistoryRowInput): string | null {
  const comment = cleanString(row.decision_comment) ?? firstComment(payloadScopes(row));
  return comment ? truncate(comment) : null;
}

export function approvalHistoryTone(row: ApprovalHistoryRowInput): ApprovalHistoryTone {
  if (previewApprovalComment(row)) return "commented";
  switch (row.status) {
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "denied":
      return "denied";
    default:
      return "neutral";
  }
}

export function buildApprovalHistoryContext(
  row: ApprovalHistoryRowInput,
): ApprovalHistoryContext {
  const scopes = payloadScopes(row);
  const payloadSummary = firstField(scopes, [
    "summary",
    "requestSummary",
    "request_summary",
    "purpose",
    "description",
    "reason",
  ]);
  const summary = truncate(
    payloadSummary ??
      firstField(scopes, ["title", "requestTitle", "request_title", "name"]) ??
      (titleIsOnlyTransition(row.title) ? `${displayEventLabel(row.kind)} approval from ${displaySourceLabel(row.source)}` : row.title),
    120,
  );
  const detail = firstField(scopes, ["detail", "details", "body", "message"]);

  const requester = firstField(scopes, [
    "requester",
    "requesterName",
    "requester_name",
    "requestedBy",
    "requested_by",
    "requestingAgent",
    "requesting_agent",
    "fromAgent",
    "from_agent",
  ]);
  const agent = firstField(scopes, [
    "agent",
    "agentName",
    "agent_name",
    "assignee",
    "assigneeName",
    "assignee_name",
    "toAgent",
    "to_agent",
  ]);
  const action = displayEventLabel(firstField(scopes, ["action", "operation", "kind", "intent"]) ?? row.kind);
  const target = firstField(scopes, [
    "target",
    "targetName",
    "target_name",
    "resource",
    "service",
    "repo",
    "repository",
    "environment",
    "company",
    "companyName",
    "company_name",
  ]);

  return {
    summary,
    detail: row.detail ? truncate(row.detail, 160) : detail ? truncate(detail, 160) : null,
    actorLine: requester && agent ? `${displaySourceLabel(requester)} → ${displaySourceLabel(agent)}` : displaySourceLabel(requester ?? agent ?? row.source),
    targetLine: target ? `${action} · ${target}` : action,
    commentPreview: previewApprovalComment(row),
  };
}
