import assert from "node:assert/strict";
import test from "node:test";

import {
  APM_ERROR_SUMMARY_BUDGET,
  summarizeApmError,
} from "./apm-error-summary.ts";

test("summarizeApmError explains gateway 502s without using the raw line as primary copy", () => {
  const raw = "2026-05-27T12:00:00Z hermes-gateway ERROR upstream returned 502 Bad Gateway while POST /gate/request/response; connect ECONNREFUSED 127.0.0.1:9119";

  const summary = summarizeApmError({
    line: raw,
    labels: { job: "hermes-gateway", app: "hermes" },
  });

  assert.equal(summary.subsystem, "Hermes gateway");
  assert.match(summary.title, /Gateway request failed/i);
  assert.match(summary.meaning, /gateway/i);
  assert.match(summary.likelyCause ?? "", /upstream/i);
  assert.notEqual(summary.primary, raw);
  assert.ok(summary.primary.length < raw.length);
});

test("summarizeApmError identifies database connectivity failures", () => {
  const summary = summarizeApmError({
    line: "paperclip-api fatal database connection failed: password authentication failed for user grafana_reader",
    labels: { job: "paperclip-api" },
  });

  assert.equal(summary.subsystem, "Paperclip API");
  assert.match(summary.title, /Database connection failed/i);
  assert.match(summary.likelyCause ?? "", /credential|database/i);
});

test("summarizeApmError keeps summary text within the APM token budget", () => {
  const noisyLine = `console ERROR ${"stack frame with repeated diagnostic context ".repeat(80)}`;
  const summary = summarizeApmError({ line: noisyLine, labels: { job: "console" } });

  assert.ok(summary.budget.inputTokens <= APM_ERROR_SUMMARY_BUDGET.maxInputTokens);
  assert.ok(summary.budget.outputTokens <= APM_ERROR_SUMMARY_BUDGET.maxOutputTokens);
  assert.match(summary.budget.label, /APM summary budget/i);
});
