import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalHistoryTone,
  buildApprovalHistoryContext,
  previewApprovalComment,
  type ApprovalHistoryRowInput,
} from "./approval-history-display.ts";

function row(overrides: Partial<ApprovalHistoryRowInput> = {}): ApprovalHistoryRowInput {
  return {
    id: "abc12345-dead-beef",
    source: "paperclip",
    kind: "deploy",
    title: "pending → approved",
    detail: null,
    status: "approved",
    requested_at: "2026-05-27T12:00:00.000Z",
    decided_at: "2026-05-27T12:05:00.000Z",
    decided_via: "telegram",
    actor: "dj",
    payload: {},
    expires_at: null,
    ...overrides,
  };
}

test("buildApprovalHistoryContext prefers request context over transition-only titles", () => {
  const context = buildApprovalHistoryContext(
    row({
      payload: {
        requester: "paperclip ceo",
        agent: "deploy-bot",
        action: "deploy",
        target: "console-v2",
        summary: "Ship the approvals context polish",
      },
    }),
  );

  assert.equal(context.summary, "Ship the approvals context polish");
  assert.equal(context.actorLine, "Paperclip Ceo → Deploy Bot");
  assert.equal(context.targetLine, "Deploy · console-v2");
});

test("buildApprovalHistoryContext reads nested request_context titles and detail", () => {
  const context = buildApprovalHistoryContext(
    row({
      payload: {
        request_context: {
          title: "Rotate production webhook secret",
          detail: "Operator approval required before writing the new HMAC secret.",
          requested_by: "hemi",
          agent_name: "coda",
          operation: "secret rotation",
          resource: "hermes-webhook.env",
        },
      },
    }),
  );

  assert.equal(context.summary, "Rotate production webhook secret");
  assert.equal(context.detail, "Operator approval required before writing the new HMAC secret.");
  assert.equal(context.actorLine, "Hemi → Coda");
  assert.equal(context.targetLine, "Secret Rotation · hermes-webhook.env");
});

test("buildApprovalHistoryContext falls back cleanly for legacy partial rows", () => {
  const context = buildApprovalHistoryContext(
    row({
      title: "Deploy hermes-gateway",
      detail: "Restart with the new gate route enabled",
      actor: null,
      decided_via: null,
      payload: {},
    }),
  );

  assert.equal(context.summary, "Deploy hermes-gateway");
  assert.equal(context.actorLine, "Paperclip");
  assert.equal(context.targetLine, "Deploy");
  assert.equal(context.detail, "Restart with the new gate route enabled");
});

test("previewApprovalComment prefers canonical decision comments", () => {
  assert.equal(
    previewApprovalComment(
      row({ decision_comment: "Approved after confirming the snapshot is complete." }),
    ),
    "Approved after confirming the snapshot is complete.",
  );
});

test("previewApprovalComment finds decision and standalone comment fields", () => {
  assert.equal(
    previewApprovalComment(
      row({ payload: { decisionNote: "Approved, but roll forward only after the DB snapshot finishes." } }),
    ),
    "Approved, but roll forward only after the DB snapshot finishes.",
  );
  assert.equal(
    previewApprovalComment(row({ payload: { commentBody: "Need a smaller blast radius." } })),
    "Need a smaller blast radius.",
  );
});

test("approvalHistoryTone distinguishes pending, approved, denied, and commented rows", () => {
  assert.equal(approvalHistoryTone(row({ status: "pending" })), "pending");
  assert.equal(approvalHistoryTone(row({ status: "approved" })), "approved");
  assert.equal(approvalHistoryTone(row({ status: "denied" })), "denied");
  assert.equal(approvalHistoryTone(row({ status: "approved", payload: { commentBody: "LGTM" } })), "commented");
});
