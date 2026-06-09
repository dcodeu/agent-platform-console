import assert from "node:assert/strict";
import test from "node:test";

import { displayEventLabel, displayWorkflowLabel } from "../views/v2/data/display.ts";
import { resolveEventDisplayName } from "./event-display-names.ts";

test("resolveEventDisplayName returns registered friendly labels for known event kinds", () => {
  assert.equal(resolveEventDisplayName("synthesize iMessage"), "Hemi drafted iMessage reply");
  assert.equal(resolveEventDisplayName("synthesize-imessage"), "Hemi drafted iMessage reply");
  assert.equal(resolveEventDisplayName("Claude Code session ended"), "Claude Code wrapped a coding session");
  assert.equal(resolveEventDisplayName("claude-code-session-ended"), "Claude Code wrapped a coding session");
});

test("resolveEventDisplayName accepts dotted, hyphenated, underscored, spaced, and camelCase event keys", () => {
  assert.equal(resolveEventDisplayName("alert.created", { source: "alert" }), "Platform alert opened");
  assert.equal(resolveEventDisplayName("alert-resolved", { source: "alert" }), "Platform alert resolved");
  assert.equal(resolveEventDisplayName("codex-worker.quarantine", { source: "codex" }), "Codex worker quarantined");
  assert.equal(resolveEventDisplayName("cost.tick", { source: "platform" }), "Cost telemetry updated");
  assert.equal(resolveEventDisplayName("approval_decided", { source: "approval" }), "Approval decided");
  assert.equal(resolveEventDisplayName("tokenBurst", { source: "tokens" }), "Token burst");
});

test("displayWorkflowLabel uses the central event registry for known workflow names", () => {
  assert.equal(displayWorkflowLabel("synthesize-imessage"), "Hemi drafted iMessage reply");
  assert.equal(displayWorkflowLabel("claude-code-session-ended"), "Claude Code wrapped a coding session");
  assert.equal(displayWorkflowLabel("codex-pool-quarantined"), "Codex pool quarantined a worker");
  assert.equal(displayWorkflowLabel("outbox-drainer"), "Outbox drainer processed messages");
  assert.equal(displayWorkflowLabel("sendblue-enqueue"), "Sendblue queued an iMessage");
});

test("displayEventLabel prefers the central event registry over generic status labels", () => {
  assert.equal(displayEventLabel("alert"), "Platform alert");
  assert.equal(displayEventLabel("approval"), "Approval request");
  assert.equal(displayEventLabel("tokens"), "Token activity");
});

test("generic display helpers do not leak bare unknown placeholders", () => {
  assert.equal(displayEventLabel("unknown"), "Not reported");
  assert.equal(displayEventLabel("(unknown)"), "Not reported");
  assert.equal(displayWorkflowLabel("(none)"), "None");
});

test("all audited alert kinds have registered plain-English event names", () => {
  const cases: Record<string, string> = {
    stuck_agent: "Agent heartbeat went stale",
    approval_pending: "Approval waiting on DJ",
    cron_failed: "Cron job failed",
    budget_forecast: "Budget forecast crossed threshold",
    backup_stale: "Backup is stale",
    domain_expiring: "Domain is nearing expiration",
    vps_action_stuck: "VPS action is stuck",
    upstream_down: "Upstream service is down",
    gateway_down: "Hermes gateway is down",
  };

  for (const [kind, label] of Object.entries(cases)) {
    assert.equal(resolveEventDisplayName(kind, { source: "alert" }), label);
  }
});

