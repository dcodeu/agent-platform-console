// queries.ts — typed TanStack Query hooks for the v2 console.
//
// All hooks share the same singleton QueryClient (see queryClient.ts). React
// Query dedupes by queryKey, so multiple tiles calling useSnapshot() trigger
// one network fetch, not N.
//
// staleTime mirrors the server-side cache:
//   - /api/snapshot.json     → 4s   (SNAPSHOT_STALE_MS)
//   - /api/ops/heavy.json    → 60s  (HEAVY_STALE_MS)
//   - /api/alerts            → 10s  (ALERTS_STALE_MS)
//   - /api/companies         → 60s  (derived from heavy)
//
// Type surface: we re-export the server's exact Snapshot / HeavySnapshot /
// Alert types so callers stay in sync with the API. These imports cross
// module boundaries but are erased at build (type-only).

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { Snapshot } from "../../../lib/snapshot.ts";
import type { HeavySnapshot } from "../../../lib/heavy.ts";
import type { Alert } from "../../../lib/alerts.ts";
import type { PaperclipCompany } from "../../../lib/paperclip-api.ts";

import { SNAPSHOT_STALE_MS, HEAVY_STALE_MS, ALERTS_STALE_MS } from "./queryClient.ts";

export type SnapshotPayload = Snapshot;
export type HeavyPayload = HeavySnapshot;
export type AlertItem = Alert;
export type CompanyItem = PaperclipCompany;

export const queryKeys = {
  snapshot: ["snapshot"] as const,
  heavy: ["heavy"] as const,
  alerts: ["alerts"] as const,
  companies: ["companies"] as const,
  approvalsPending: ["approvals", "pending"] as const,
  approvalsAll: ["approvals", "all"] as const,
} as const;

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function useSnapshot(): UseQueryResult<SnapshotPayload> {
  return useQuery({
    queryKey: queryKeys.snapshot,
    queryFn: ({ signal }) => fetchJson<SnapshotPayload>("/api/snapshot.json", signal),
    staleTime: SNAPSHOT_STALE_MS,
    refetchInterval: SNAPSHOT_STALE_MS,
  });
}

export function useHeavy(): UseQueryResult<HeavyPayload> {
  return useQuery({
    queryKey: queryKeys.heavy,
    queryFn: ({ signal }) => fetchJson<HeavyPayload>("/api/ops/heavy.json", signal),
    staleTime: HEAVY_STALE_MS,
    refetchInterval: HEAVY_STALE_MS,
  });
}

interface AlertsResponse {
  alerts: AlertItem[];
  generatedAt: number;
}

export function useAlerts(): UseQueryResult<AlertsResponse> {
  return useQuery({
    queryKey: queryKeys.alerts,
    queryFn: ({ signal }) => fetchJson<AlertsResponse>("/api/alerts", signal),
    staleTime: ALERTS_STALE_MS,
    refetchInterval: ALERTS_STALE_MS,
  });
}

interface CompaniesResponse {
  companies: CompanyItem[];
  activeCompanyId: string;
}

export function useCompanies(): UseQueryResult<CompaniesResponse> {
  return useQuery({
    queryKey: queryKeys.companies,
    queryFn: ({ signal }) => fetchJson<CompaniesResponse>("/api/companies", signal),
    staleTime: HEAVY_STALE_MS,
    refetchInterval: HEAVY_STALE_MS,
  });
}

// ────────────────────────────────────────────────────────────
// Approvals
// ────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

export type DecidedVia = "ui" | "telegram" | "imessage" | "cli" | "auto-expire";

export interface ApprovalRow {
  id: string;
  source: string;
  kind: string;
  title: string;
  detail: string | null;
  status: ApprovalStatus;
  requested_at: string;
  decided_at: string | null;
  decided_via: DecidedVia | null;
  decision_comment: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
  expires_at: string | null;
}

interface ApprovalsResponse {
  approvals: ApprovalRow[];
  count: number;
}

export function useApprovalsPending(): UseQueryResult<ApprovalsResponse> {
  return useQuery({
    queryKey: queryKeys.approvalsPending,
    queryFn: ({ signal }) =>
      fetchJson<ApprovalsResponse>("/api/approvals?status=pending&limit=200", signal),
    staleTime: HEAVY_STALE_MS,
    refetchInterval: HEAVY_STALE_MS,
  });
}

export function useApprovalsHistory(limit = 100): UseQueryResult<ApprovalsResponse> {
  return useQuery({
    queryKey: [...queryKeys.approvalsAll, limit] as const,
    queryFn: ({ signal }) =>
      fetchJson<ApprovalsResponse>(`/api/approvals?status=all&limit=${limit}`, signal),
    staleTime: HEAVY_STALE_MS,
    refetchInterval: HEAVY_STALE_MS,
  });
}

export async function postApprovalDecision(
  id: string,
  action: "approve" | "deny" | "cancel",
  via: DecidedVia = "ui",
  actor?: string,
  comment?: string,
): Promise<{ ok: boolean; status?: ApprovalStatus; error?: string }> {
  const res = await fetch(`/api/approvals/${encodeURIComponent(id)}/decide`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action, via, actor, comment }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: ApprovalStatus;
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: body.ok ?? true, status: body.status };
}

export async function createApproval(input: {
  source: string;
  kind: string;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  expiresAt?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const res = await fetch("/api/approvals", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: string;
  };
  if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  return { ok: true, id: body.id };
}
