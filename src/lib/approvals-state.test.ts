import assert from "node:assert/strict";
import test from "node:test";

import {
  createApproval,
  decideApproval,
  listApprovalEvents,
  resetApprovalTestHooks,
  setApprovalTestHooks,
  type ApprovalRow,
} from "./approvals.ts";

type EventRow = {
  seq: number;
  approval_id: string;
  event_type: string;
  status: string;
  emitted_at: string;
  row_snapshot: ApprovalRow;
};

class FakeApprovalPool {
  rows = new Map<string, ApprovalRow>();
  idempotency = new Map<string, string>();
  events: EventRow[] = [];
  nextSeq = 1;

  async query(sql: string, params: unknown[] = []): Promise<{ rows: any[] }> {
    const compact = sql.replace(/\s+/g, " ").trim();

    if (compact.startsWith("SELECT * FROM approvals WHERE id = $1")) {
      const row = this.rows.get(String(params[0]));
      return { rows: row ? [row] : [] };
    }

    if (compact.includes("FROM approvals") && compact.includes("idempotency_key = $1")) {
      const key = String(params[0]);
      const id = this.idempotency.get(key);
      const row = id ? this.rows.get(id) : null;
      return { rows: row ? [row] : [] };
    }

    if (compact.startsWith("INSERT INTO approvals")) {
      const id = String(params[0]);
      if (this.rows.has(id)) return { rows: [this.rows.get(id)] };
      const now = new Date().toISOString();
      const payload = JSON.parse(String(params[5] ?? "{}"));
      const idempotencyKey = params[7] == null ? null : String(params[7]);
      if (idempotencyKey && this.idempotency.has(idempotencyKey)) {
        const existing = this.rows.get(this.idempotency.get(idempotencyKey)!);
        return { rows: existing ? [existing] : [] };
      }
      const row: ApprovalRow = {
        id,
        source: String(params[1]),
        kind: String(params[2]),
        title: String(params[3]),
        detail: params[4] == null ? null : String(params[4]),
        status: "pending",
        requested_at: now,
        decided_at: null,
        decided_via: null,
        decision_comment: null,
        actor: null,
        payload,
        expires_at: params[6] == null ? null : new Date(params[6] as string).toISOString(),
        telegram_message_id: null,
        telegram_chat_id: null,
        escalated_at: null,
        idempotency_key: idempotencyKey,
        created_event_at: now,
        updated_at: now,
        closed_at: null,
      };
      this.rows.set(id, row);
      if (idempotencyKey) this.idempotency.set(idempotencyKey, id);
      return { rows: [row] };
    }

    if (compact.startsWith("UPDATE approvals") && compact.includes("WHERE id = $4 AND status = 'pending'")) {
      const id = String(params[3]);
      const row = this.rows.get(id);
      if (!row || row.status !== "pending") return { rows: [] };
      const now = new Date().toISOString();
      const updated: ApprovalRow = {
        ...row,
        status: params[0] as ApprovalRow["status"],
        decided_at: now,
        decided_via: params[1] as ApprovalRow["decided_via"],
        actor: params[2] == null ? row.actor : String(params[2]),
        decision_comment: params[4] == null ? null : String(params[4]),
        updated_at: now,
        closed_at: now,
      };
      this.rows.set(id, updated);
      return { rows: [updated] };
    }

    if (compact.startsWith("INSERT INTO approval_events")) {
      const row = params[3] as ApprovalRow;
      const event: EventRow = {
        seq: this.nextSeq++,
        approval_id: String(params[0]),
        event_type: String(params[1]),
        status: String(params[2]),
        emitted_at: new Date().toISOString(),
        row_snapshot: row,
      };
      this.events.push(event);
      return { rows: [event] };
    }

    if (compact.startsWith("SELECT * FROM approval_events")) {
      const minSeq = Number(params[0] ?? 0);
      return { rows: this.events.filter((event) => event.seq > minSeq) };
    }

    throw new Error(`unhandled SQL in fake pool: ${compact}`);
  }
}

function installFake() {
  const pool = new FakeApprovalPool();
  const broadcasts: Array<{ event: string; data: unknown }> = [];
  setApprovalTestHooks({
    pool: pool as any,
    broadcast: (event, data) => broadcasts.push({ event, data }),
  });
  return { pool, broadcasts };
}

test.afterEach(() => resetApprovalTestHooks());

test("duplicate create submissions keep one durable id and emit one create event", async () => {
  const { broadcasts } = installFake();

  const first = await createApproval({
    id: "approval-1",
    source: "paperclip",
    kind: "deploy",
    title: "Ship console",
    idempotencyKey: "paperclip:deploy:42",
    silent: true,
  });
  const second = await createApproval({
    id: "ignored-new-id",
    source: "paperclip",
    kind: "deploy",
    title: "Ship console",
    idempotencyKey: "paperclip:deploy:42",
    silent: true,
  });

  assert.equal(first.id, "approval-1");
  assert.equal(first.created, true);
  assert.equal(second.id, "approval-1");
  assert.equal(second.created, false);
  assert.equal(broadcasts.filter((b) => b.event === "approval.created").length, 1);

  const events = await listApprovalEvents({ afterSeq: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "created");
  assert.equal(events[0].approval_id, "approval-1");
});

test("duplicate terminal decisions are idempotent and emit one update plus one close event", async () => {
  const { broadcasts } = installFake();
  await createApproval({ id: "approval-2", source: "telegram", kind: "custom", title: "Continue", silent: true });

  const first = await decideApproval({ id: "approval-2", action: "approve", via: "telegram", actor: "tg:1" });
  const second = await decideApproval({ id: "approval-2", action: "approve", via: "telegram", actor: "tg:1" });

  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.status, "approved");
  assert.equal(broadcasts.filter((b) => b.event === "approval.updated").length, 1);
  assert.equal(broadcasts.filter((b) => b.event === "approval.closed").length, 1);

  const events = await listApprovalEvents({ afterSeq: 0 });
  assert.deepEqual(events.map((event) => event.event_type), ["created", "updated", "closed"]);
});

test("decisions persist sanitized comments on the returned row and event snapshots", async () => {
  const { broadcasts } = installFake();
  await createApproval({ id: "approval-comment", source: "ui", kind: "custom", title: "Continue", silent: true });

  const result = await decideApproval({
    id: "approval-comment",
    action: "deny",
    via: "ui",
    actor: "dj",
    comment: "  blocking reason\r\nwith context  ",
  });

  assert.equal(result.ok, true);
  assert.equal(result.row?.decision_comment, "blocking reason\nwith context");
  const decided = broadcasts.find((b) => b.event === "approval.decided");
  assert.equal((decided?.data as ApprovalRow | undefined)?.decision_comment, "blocking reason\nwith context");

  const events = await listApprovalEvents({ afterSeq: 0 });
  const closed = events.find((event) => event.event_type === "closed");
  assert.equal(closed?.row_snapshot.decision_comment, "blocking reason\nwith context");
});

test("conflicting duplicate terminal decisions return the canonical terminal state without a second transition", async () => {
  const { broadcasts } = installFake();
  await createApproval({ id: "approval-3", source: "ui", kind: "merge", title: "Merge PR", silent: true });

  const first = await decideApproval({ id: "approval-3", action: "reject", via: "ui", actor: "dj" });
  const second = await decideApproval({ id: "approval-3", action: "dismiss", via: "ui", actor: "dj" });

  assert.equal(first.ok, true);
  assert.equal(first.status, "denied");
  assert.equal(second.ok, false);
  assert.equal(second.reason, "not pending (status=denied)");
  assert.equal(second.row?.status, "denied");
  assert.equal(broadcasts.filter((b) => b.event === "approval.updated").length, 1);
});
