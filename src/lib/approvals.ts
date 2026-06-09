// approvals.ts — unified approvals queue for the Agent Platform.
//
// One INSERT here, fanout everywhere: a row lands in Postgres, an SSE event
// fires (so the UI updates immediately), and a Telegram inline-keyboard
// message gets sent so DJ can decide on the phone. iMessage URGENT escalation
// fires from a sweeper if a row stays pending past its escalate-after window.
//
// This system is INTENTIONALLY DIFFERENT from Hermes's existing /gate/*
// endpoints in apps/hermes/src/gateway/gate.py. That gate is HMAC-signed,
// short-TTL, and exists specifically to gate destructive tool calls from
// outside agents. THIS system is the user-visible approval queue surfaced in
// the console: deploys, merges, spend approvals, custom flows from Paperclip
// and elsewhere. They can federate via `payload.gate_request_id` when an
// approval is also gated at the security layer.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_HOME_CHANNEL,
  TELEGRAM_ALLOWED_USERS,
  SENDBLUE_SEND_BIN,
} from "../config.ts";
import { getAiInvocationsPool } from "./pg-pool.ts";
import { broadcast } from "./sse.ts";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

export type ApprovalKind = "deploy" | "merge" | "destructive" | "spend" | "custom";

export type DecidedVia = "ui" | "telegram" | "imessage" | "cli" | "auto-expire";

export interface ApprovalRow {
  id: string;
  source: string;
  kind: string;
  title: string;
  detail: string | null;
  status: ApprovalStatus;
  requested_at: string; // ISO
  decided_at: string | null; // ISO
  decided_via: DecidedVia | null;
  decision_comment: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
  expires_at: string | null; // ISO
  telegram_message_id: number | null;
  telegram_chat_id: string | null;
  escalated_at: string | null; // ISO
  idempotency_key: string | null;
  created_event_at: string | null; // ISO
  updated_at: string | null; // ISO
  closed_at: string | null; // ISO
}

export interface CreateApprovalInput {
  source: string;
  kind: ApprovalKind | string;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  expiresAt?: string | Date | null;
  /** Override the row id (otherwise a UUIDv4 is generated). */
  id?: string;
  /** Stable duplicate-submission key; retries return the original row/id. */
  idempotencyKey?: string;
  /** If true, suppress Telegram delivery (test/internal flow). */
  silent?: boolean;
}

export interface DecideApprovalInput {
  id: string;
  action: "approve" | "deny" | "reject" | "cancel" | "dismiss" | "expire";
  via: DecidedVia;
  actor?: string;
  comment?: unknown;
}

export interface ListApprovalsInput {
  status?: ApprovalStatus | "all";
  limit?: number;
  before?: string; // ISO — pagination cursor on requested_at
  after?: string; // ISO
  source?: string;
}

export interface ApprovalEventRow {
  seq: number;
  approval_id: string;
  event_type: "created" | "updated" | "closed";
  status: ApprovalStatus;
  emitted_at: string;
  row_snapshot: ApprovalRow;
}

export interface ListApprovalEventsInput {
  afterSeq?: number;
  limit?: number;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

type QueryablePool = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

let testPoolOverride: QueryablePool | null = null;
let testBroadcastOverride: ((event: string, data: unknown) => void) | null = null;

export function setApprovalTestHooks(hooks: {
  pool?: QueryablePool;
  broadcast?: (event: string, data: unknown) => void;
}): void {
  testPoolOverride = hooks.pool ?? null;
  testBroadcastOverride = hooks.broadcast ?? null;
}

export function resetApprovalTestHooks(): void {
  testPoolOverride = null;
  testBroadcastOverride = null;
}

function pool(): QueryablePool {
  const p = testPoolOverride ?? getAiInvocationsPool();
  if (!p) {
    throw new Error(
      "[approvals] AI_INVOCATIONS_DB_URL is not configured — approvals require Postgres",
    );
  }
  return p;
}

function emitSse(event: string, data: unknown): void {
  (testBroadcastOverride ?? broadcast)(event, data);
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowFromDb(r: Record<string, unknown>): ApprovalRow {
  return {
    id: String(r.id),
    source: String(r.source),
    kind: String(r.kind),
    title: String(r.title),
    detail: r.detail == null ? null : String(r.detail),
    status: r.status as ApprovalStatus,
    requested_at:
      r.requested_at instanceof Date
        ? r.requested_at.toISOString()
        : String(r.requested_at),
    decided_at:
      r.decided_at == null
        ? null
        : r.decided_at instanceof Date
          ? r.decided_at.toISOString()
          : String(r.decided_at),
    decided_via: r.decided_via == null ? null : (r.decided_via as DecidedVia),
    decision_comment:
      r.decision_comment == null ? null : String(r.decision_comment),
    actor: r.actor == null ? null : String(r.actor),
    payload: (r.payload ?? {}) as Record<string, unknown>,
    expires_at:
      r.expires_at == null
        ? null
        : r.expires_at instanceof Date
          ? r.expires_at.toISOString()
          : String(r.expires_at),
    telegram_message_id:
      r.telegram_message_id == null ? null : Number(r.telegram_message_id),
    telegram_chat_id:
      r.telegram_chat_id == null ? null : String(r.telegram_chat_id),
    escalated_at:
      r.escalated_at == null
        ? null
        : r.escalated_at instanceof Date
          ? r.escalated_at.toISOString()
          : String(r.escalated_at),
    idempotency_key:
      r.idempotency_key == null ? null : String(r.idempotency_key),
    created_event_at: isoOrNull(r.created_event_at),
    updated_at: isoOrNull(r.updated_at ?? r.requested_at),
    closed_at: isoOrNull(r.closed_at),
  };
}

const ACTION_TO_STATUS: Record<DecideApprovalInput["action"], ApprovalStatus> = {
  approve: "approved",
  deny: "denied",
  reject: "denied",
  cancel: "cancelled",
  dismiss: "cancelled",
  expire: "expired",
};

const MAX_DECISION_COMMENT_LENGTH = 2_000;

export function sanitizeApprovalDecisionComment(comment: unknown): string | null {
  if (comment == null) return null;
  if (typeof comment !== "string") {
    throw new Error("comment must be a string");
  }
  const normalized = comment.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_DECISION_COMMENT_LENGTH);
}

function eventFromDb(r: Record<string, unknown>): ApprovalEventRow {
  return {
    seq: Number(r.seq),
    approval_id: String(r.approval_id),
    event_type: r.event_type as ApprovalEventRow["event_type"],
    status: r.status as ApprovalStatus,
    emitted_at: isoOrNull(r.emitted_at) ?? new Date(0).toISOString(),
    row_snapshot: rowFromDb((r.row_snapshot ?? {}) as Record<string, unknown>),
  };
}

async function recordApprovalEvent(
  p: QueryablePool,
  eventType: ApprovalEventRow["event_type"],
  row: ApprovalRow,
): Promise<void> {
  await p.query(
    `INSERT INTO approval_events (approval_id, event_type, status, row_snapshot)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (approval_id, event_type, status) DO NOTHING
     RETURNING *`,
    [row.id, eventType, row.status, row],
  );
}

function decisionCallbackUrl(row: ApprovalRow): string | null {
  const raw = row.payload.callback_url ?? row.payload.callbackUrl;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function postDecisionCallback(row: ApprovalRow): Promise<void> {
  const url = decisionCallbackUrl(row);
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      id: row.id,
      status: row.status,
      decision: {
        status: row.status,
        via: row.decided_via,
        actor: row.actor,
        comment: row.decision_comment,
        decided_at: row.decided_at,
      },
      request_context: row.payload.request_context ?? null,
      row,
    }),
    signal: AbortSignal.timeout(5_000),
  });
}

// ────────────────────────────────────────────────────────────
// Core API
// ────────────────────────────────────────────────────────────

export async function createApproval(
  input: CreateApprovalInput,
): Promise<{ id: string; created: boolean }> {
  const id = input.id ?? randomUUID();
  const expiresAt =
    input.expiresAt == null
      ? null
      : input.expiresAt instanceof Date
        ? input.expiresAt
        : new Date(input.expiresAt);

  const p = pool();
  if (input.idempotencyKey) {
    const existing = await p.query(
      `SELECT * FROM approvals WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );
    if (existing.rows.length > 0) {
      return { id: rowFromDb(existing.rows[0]).id, created: false };
    }
  }
  const { rows } = await p.query(
    `INSERT INTO approvals (id, source, kind, title, detail, payload, expires_at, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING *`,
    [
      id,
      input.source,
      input.kind,
      input.title,
      input.detail ?? null,
      JSON.stringify(input.payload ?? {}),
      expiresAt,
      input.idempotencyKey ?? null,
    ],
  );
  const row = rowFromDb(rows[0]);
  await recordApprovalEvent(p, "created", row);

  // SSE fanout — the UI listens on /api/stream.
  emitSse("approval.created", row);

  // Telegram delivery — fire-and-forget so the caller isn't blocked.
  if (!input.silent) {
    void sendTelegramApproval(row).catch((e) => {
      console.error("[approvals] telegram delivery failed", id, e);
    });
  }

  return { id, created: true };
}

export async function decideApproval(
  input: DecideApprovalInput,
): Promise<{ ok: boolean; status?: ApprovalStatus; reason?: string; row?: ApprovalRow; changed?: boolean }> {
  const targetStatus = ACTION_TO_STATUS[input.action];
  if (!targetStatus) {
    return { ok: false, reason: `invalid action: ${input.action}` };
  }
  let decisionComment: string | null;
  try {
    decisionComment = sanitizeApprovalDecisionComment(input.comment);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const p = pool();
  const { rows } = await p.query(
    `UPDATE approvals
        SET status = $1,
            decided_at = now(),
            decided_via = $2,
            actor = COALESCE($3, actor),
            decision_comment = $5,
            updated_at = now(),
            closed_at = now()
      WHERE id = $4 AND status = 'pending'
      RETURNING *`,
    [targetStatus, input.via, input.actor ?? null, input.id, decisionComment],
  );
  if (rows.length === 0) {
    // Either the id doesn't exist or it's no longer pending.
    const existing = await p.query(
      `SELECT * FROM approvals WHERE id = $1`,
      [input.id],
    );
    if (existing.rows.length === 0) {
      return { ok: false, reason: "not found" };
    }
    const existingRow = rowFromDb(existing.rows[0]);
    if (existingRow.status === targetStatus) {
      return { ok: true, status: existingRow.status, row: existingRow, changed: false } as any;
    }
    return {
      ok: false,
      reason: `not pending (status=${existingRow.status})`,
      row: existingRow,
    };
  }
  const row = rowFromDb(rows[0]);

  await recordApprovalEvent(p, "updated", row);
  await recordApprovalEvent(p, "closed", row);
  emitSse("approval.updated", row);
  emitSse("approval.closed", row);
  emitSse("approval.decided", row);

  // Best-effort: edit the original Telegram message to show the decision.
  void editTelegramAfterDecision(row).catch((e) => {
    console.warn("[approvals] telegram edit failed", row.id, e);
  });

  return { ok: true, status: targetStatus, row, changed: true } as any;
}

export async function listApprovalEvents(
  input: ListApprovalEventsInput = {},
): Promise<ApprovalEventRow[]> {
  const p = pool();
  const afterSeq = Math.max(0, input.afterSeq ?? 0);
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1_000));
  const { rows } = await p.query(
    `SELECT * FROM approval_events
      WHERE seq > $1
      ORDER BY seq ASC
      LIMIT $2`,
    [afterSeq, limit],
  );
  return rows.map(eventFromDb);
}

export async function getApproval(id: string): Promise<ApprovalRow | null> {
  const p = pool();
  const { rows } = await p.query(`SELECT * FROM approvals WHERE id = $1`, [id]);
  return rows.length > 0 ? rowFromDb(rows[0]) : null;
}

export async function listApprovals(
  input: ListApprovalsInput = {},
): Promise<ApprovalRow[]> {
  const p = pool();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 500));
  const params: unknown[] = [];
  const where: string[] = [];

  if (input.status && input.status !== "all") {
    params.push(input.status);
    where.push(`status = $${params.length}`);
  }
  if (input.source) {
    params.push(input.source);
    where.push(`source = $${params.length}`);
  }
  if (input.before) {
    params.push(input.before);
    where.push(`requested_at < $${params.length}`);
  }
  if (input.after) {
    params.push(input.after);
    where.push(`requested_at > $${params.length}`);
  }
  params.push(limit);
  const limitParam = `$${params.length}`;

  const sql = `
    SELECT *
      FROM approvals
     ${where.length > 0 ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY requested_at DESC
     LIMIT ${limitParam}
  `;
  const { rows } = await p.query(sql, params);
  return rows.map(rowFromDb);
}

// ────────────────────────────────────────────────────────────
// Telegram delivery
// ────────────────────────────────────────────────────────────

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface TgSendMessageResult {
  message_id?: number;
  chat?: { id?: number };
}

function tgChatId(): string | null {
  return TELEGRAM_HOME_CHANNEL || null;
}

function tgEscape(s: string): string {
  return s.replace(/`/g, "'").slice(0, 1000);
}

async function sendTelegramApproval(row: ApprovalRow): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("[approvals] TELEGRAM_BOT_TOKEN not set — skipping delivery");
    return;
  }
  const chat = tgChatId();
  if (!chat) {
    console.warn("[approvals] TELEGRAM_HOME_CHANNEL not set — skipping delivery");
    return;
  }

  const shortId = row.id.slice(0, 8);
  const lines = [
    `🛂 *Approval needed* — \`${row.kind}\``,
    "",
    `*${tgEscape(row.title)}*`,
  ];
  if (row.detail) lines.push("", tgEscape(row.detail));
  lines.push("", `_source:_ \`${tgEscape(row.source)}\``);
  if (row.expires_at) {
    const ms = Date.parse(row.expires_at) - Date.now();
    if (Number.isFinite(ms) && ms > 0) {
      const mins = Math.round(ms / 60000);
      lines.push(`_expires in:_ ~${mins} min`);
    }
  }
  lines.push("", `\`approval ${shortId}\``);

  const keyboard: InlineKeyboardButton[][] = [
    [
      { text: "✓ Approve", callback_data: `approval:${row.id}:approve` },
      { text: "✗ Deny", callback_data: `approval:${row.id}:deny` },
    ],
  ];

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chat,
    text: lines.join("\n"),
    parse_mode: "Markdown" as const,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: keyboard },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(
      `[approvals] tg sendMessage ${res.status}: ${text.slice(0, 300)}`,
    );
    return;
  }
  const data = (await res.json()) as { result?: TgSendMessageResult };
  const messageId = data.result?.message_id;
  const chatId = data.result?.chat?.id;
  if (messageId) {
    // Persist so we can edit it in place on decision.
    const p = pool();
    await p.query(
      `UPDATE approvals
          SET telegram_message_id = $1::int,
              telegram_chat_id = $2::text
        WHERE id = $3`,
      [messageId, chatId == null ? chat : String(chatId), row.id],
    );
  }
}

async function editTelegramAfterDecision(row: ApprovalRow): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;
  const legacyPayload = row.payload ?? {};
  const messageId =
    row.telegram_message_id ??
    ((legacyPayload.telegram_message_id as number | undefined) ?? null);
  const chatId =
    row.telegram_chat_id ??
    ((legacyPayload.telegram_chat_id as string | undefined) ?? tgChatId());
  if (!messageId || !chatId) return;

  const verb =
    row.status === "approved"
      ? "✅ Approved"
      : row.status === "denied"
        ? "❌ Denied"
        : row.status === "cancelled"
          ? "🚫 Cancelled"
          : row.status === "expired"
            ? "⏱ Expired"
            : "•";
  const via = row.decided_via ? ` via ${row.decided_via}` : "";
  const shortId = row.id.slice(0, 8);
  const text = `${verb}${via} — *${tgEscape(row.title)}*\n\`approval ${shortId}\``;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
    }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    /* best-effort */
  });
}

export function isTelegramUserAllowed(userId: string | number): boolean {
  const allowed = new Set(
    TELEGRAM_ALLOWED_USERS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return allowed.has(String(userId));
}

// ────────────────────────────────────────────────────────────
// iMessage NLP fallback
// ────────────────────────────────────────────────────────────

const APPROVE_RE =
  /\b(?:approved?|yes|y|go ahead|ship it|do it|continue|proceed|ok|okay|lgtm)\b/i;
const DENY_RE = /\b(?:deny|denied|reject(?:ed)?|no|n|stop|cancel(?:led)?|nope|abort)\b/i;

export type ImessageIntent = "approve" | "deny" | null;

export function classifyImessageIntent(text: string): ImessageIntent {
  if (!text) return null;
  // Deny takes precedence if both somehow appear — DJ would never say
  // "approve no", but "deny" alone shouldn't be drowned by "ok" in "ok deny".
  if (DENY_RE.test(text)) return "deny";
  if (APPROVE_RE.test(text)) return "approve";
  return null;
}

/**
 * Resolve which pending approval an iMessage reply refers to. Strategy:
 *   1. If the text contains a short id like "approval abc12345" or
 *      "abc12345", match that prefix.
 *   2. Else, if there's exactly one pending approval, that's the target.
 *   3. Else, fall back to the OLDEST pending approval (FIFO) — DJ replies
 *      tend to address the urgent one that's been sitting longest.
 */
export async function resolveImessageTarget(
  text: string,
): Promise<ApprovalRow | null> {
  const p = pool();

  // Look for an explicit id prefix in the text.
  const m = text.match(/(?:approval\s+)?([0-9a-f]{6,36})/i);
  if (m && m[1]) {
    const prefix = m[1].toLowerCase();
    // Only accept a prefix match for pending rows — never reopen decided ones.
    const { rows } = await p.query(
      `SELECT * FROM approvals
        WHERE status = 'pending' AND id ILIKE $1
        ORDER BY requested_at ASC
        LIMIT 1`,
      [prefix + "%"],
    );
    if (rows.length > 0) return rowFromDb(rows[0]);
    // No pending prefix match — fall through.
  }

  const { rows } = await p.query(
    `SELECT * FROM approvals
      WHERE status = 'pending'
      ORDER BY requested_at ASC
      LIMIT 2`,
  );
  if (rows.length === 0) return null;
  return rowFromDb(rows[0]);
}

export function sendImessage(text: string): void {
  // Fire-and-forget. The helper handles its own Sendblue auth.
  const child = spawn(SENDBLUE_SEND_BIN, [text], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

// ────────────────────────────────────────────────────────────
// Escalation sweeper
// ────────────────────────────────────────────────────────────

const DEFAULT_ESCALATE_AFTER_MS = 10 * 60 * 1000; // 10 minutes
const SWEEP_INTERVAL_MS = 60 * 1000; // every minute

let sweeperHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Per-tick sweep:
 *   - Mark expired pending rows whose expires_at is in the past.
 *   - For pending rows older than ESCALATE_AFTER_MS and not yet escalated,
 *     send an URGENT iMessage and mark payload.escalated_at to dedupe.
 */
export async function sweepApprovals(): Promise<{
  expired: number;
  escalated: number;
}> {
  const p = pool();
  let expired = 0;
  let escalated = 0;

  // 1) Expire overdue rows.
  const { rows: expRows } = await p.query(
    `UPDATE approvals
        SET status = 'expired',
            decided_at = now(),
            decided_via = 'auto-expire'
      WHERE status = 'pending'
        AND expires_at IS NOT NULL
        AND expires_at < now()
      RETURNING *`,
  );
  for (const r of expRows) {
    const row = rowFromDb(r);
    broadcast("approval.decided", row);
    expired += 1;
  }

  // 2) Escalate stale pendings via iMessage URGENT.
  const cutoff = new Date(Date.now() - DEFAULT_ESCALATE_AFTER_MS).toISOString();
  const { rows: staleRows } = await p.query(
    `SELECT * FROM approvals
      WHERE status = 'pending'
        AND requested_at < $1
        AND escalated_at IS NULL
      ORDER BY requested_at ASC
      LIMIT 5`,
    [cutoff],
  );
  for (const r of staleRows) {
    const row = rowFromDb(r);
    const shortId = row.id.slice(0, 8);
    const text = `URGENT approval pending: ${row.title.slice(
      0,
      120,
    )}\nReply 'approve' or 'deny' (id ${shortId}).`;
    sendImessage(text);
    await p.query(
      `UPDATE approvals
          SET escalated_at = $1
        WHERE id = $2`,
      [new Date(), row.id],
    );
    escalated += 1;
  }
  return { expired, escalated };
}

export function startApprovalSweeper(): void {
  if (sweeperHandle) return;
  sweeperHandle = setInterval(() => {
    void sweepApprovals().catch((e) =>
      console.error("[approvals] sweep error", e),
    );
  }, SWEEP_INTERVAL_MS);
  console.log("[approvals] sweeper started (every", SWEEP_INTERVAL_MS, "ms)");
}

export function stopApprovalSweeper(): void {
  if (sweeperHandle) {
    clearInterval(sweeperHandle);
    sweeperHandle = null;
  }
}
