// use-approvals-count — count of pending approvals across both the legacy
// Paperclip approvals (surfaced via /api/ops/heavy.json) and our new unified
// approvals queue (/api/approvals?status=pending). The BottomNav badge and
// ApprovalBanner use this so the badge stays in lockstep with reality
// regardless of which producer pushed the request.

import { useHeavy, useApprovalsPending } from "../data/queries.ts";

export function useApprovalsCount(): number {
  const heavy = useHeavy();
  const pending = useApprovalsPending();
  const paperclipCount = heavy.data?.approvalsPending?.length ?? 0;
  const queueCount = pending.data?.count ?? pending.data?.approvals?.length ?? 0;
  return paperclipCount + queueCount;
}
