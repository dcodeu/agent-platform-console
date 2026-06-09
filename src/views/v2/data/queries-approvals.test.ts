import assert from "node:assert/strict";
import test from "node:test";

import { postApprovalDecision } from "./queries.ts";

test("postApprovalDecision includes optional decision comment in approve/deny body", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true, status: "approved" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await postApprovalDecision(
      "approval-123",
      "approve",
      "ui",
      "console.local",
      "snapshot checked; ship it",
    );

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/approvals/approval-123/decide");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      action: "approve",
      via: "ui",
      actor: "console.local",
      comment: "snapshot checked; ship it",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
