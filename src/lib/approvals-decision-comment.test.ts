import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeApprovalDecisionComment } from "./approvals.ts";

test("sanitizeApprovalDecisionComment preserves absent comments for legacy decisions", () => {
  assert.equal(sanitizeApprovalDecisionComment(undefined), null);
  assert.equal(sanitizeApprovalDecisionComment(null), null);
  assert.equal(sanitizeApprovalDecisionComment("   \n\t  "), null);
});

test("sanitizeApprovalDecisionComment trims, normalizes whitespace, and caps long comments", () => {
  const sanitized = sanitizeApprovalDecisionComment("  approve this\r\n\r\nwith context  ");
  assert.equal(sanitized, "approve this\n\nwith context");

  const tooLong = "x".repeat(5000);
  assert.equal(sanitizeApprovalDecisionComment(tooLong)?.length, 2000);
});

test("sanitizeApprovalDecisionComment rejects non-string comments", () => {
  assert.throws(
    () => sanitizeApprovalDecisionComment({ text: "not allowed" }),
    /comment must be a string/,
  );
});
