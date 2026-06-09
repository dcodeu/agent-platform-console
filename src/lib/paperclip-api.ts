import { PAPERCLIP_BASE } from "../config.ts";

export interface PaperclipCompany {
  id: string;
  name: string;
  description: string | null;
  status: string;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
}

export interface PaperclipAgent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string | null;
  icon: string | null;
  status: string;
  reportsTo: string | null;
  adapterType: string;
  adapterConfig?: Record<string, unknown> & {
    model?: string;
    intervalSec?: number;
    timeoutSec?: number;
  };
}

export interface PaperclipHeartbeat {
  id: string;
  companyId: string;
  companyName: string;
  companyIssuePrefix: string;
  agentName: string;
  agentUrlKey: string;
  role: string;
  title: string | null;
  status: string;
  adapterType: string;
  intervalSec: number;
  heartbeatEnabled: boolean;
  schedulerActive: boolean;
  lastHeartbeatAt: string | null;
  nextWakeAt?: string | null;
  runId?: string | null;
  lastOutputAt?: string | null;
}

export interface PaperclipCostsSummary {
  companyId: string;
  spendCents: number;
  budgetCents: number;
  utilizationPercent: number;
}

export interface PaperclipApproval {
  id: string;
  issueId?: string;
  status: string;
  requestedAt?: string;
  requestedByAgent?: string;
  approverRequired?: string;
  title?: string;
}

export interface PaperclipCostByAgent {
  agentId: string;
  agentName: string;
  costCents: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface PaperclipCostByProvider {
  provider: string;
  costCents: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface PaperclipCostByModel {
  model: string;
  agentId?: string;
  costCents: number;
}

export interface PaperclipFinanceEvent {
  id: string;
  kind: string;
  billerCode?: string;
  amountCents: number;
  incurredAt: string;
  reason?: string;
}

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

class PaperclipApiClient {
  private base = PAPERCLIP_BASE;

  async listCompanies(): Promise<PaperclipCompany[]> {
    const r = await this.get<PaperclipCompany[]>("/api/companies");
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }

  async getAgents(companyId: string): Promise<PaperclipAgent[]> {
    const r = await this.get<PaperclipAgent[]>(`/api/companies/${companyId}/agents`);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }

  async getHeartbeats(): Promise<PaperclipHeartbeat[]> {
    const r = await this.get<PaperclipHeartbeat[]>(`/api/instance/scheduler-heartbeats`);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }

  async getCostsSummary(companyId: string): Promise<PaperclipCostsSummary | null> {
    const r = await this.get<PaperclipCostsSummary>(`/api/companies/${companyId}/costs/summary`);
    return r.ok ? r.data : null;
  }

  async getCostsByAgent(companyId: string): Promise<PaperclipCostByAgent[]> {
    const r = await this.get<PaperclipCostByAgent[] | { data?: PaperclipCostByAgent[] }>(
      `/api/companies/${companyId}/costs/by-agent`,
    );
    if (!r.ok || !r.data) return [];
    return Array.isArray(r.data) ? r.data : (r.data.data ?? []);
  }

  async getCostsByProvider(companyId: string): Promise<PaperclipCostByProvider[]> {
    const r = await this.get<PaperclipCostByProvider[] | { data?: PaperclipCostByProvider[] }>(
      `/api/companies/${companyId}/costs/by-provider`,
    );
    if (!r.ok || !r.data) return [];
    return Array.isArray(r.data) ? r.data : (r.data.data ?? []);
  }

  async getCostsByModel(companyId: string): Promise<PaperclipCostByModel[]> {
    const r = await this.get<PaperclipCostByModel[] | { data?: PaperclipCostByModel[] }>(
      `/api/companies/${companyId}/costs/by-agent-model`,
    );
    if (!r.ok || !r.data) return [];
    return Array.isArray(r.data) ? r.data : (r.data.data ?? []);
  }

  async getApprovalsPending(companyId: string): Promise<PaperclipApproval[]> {
    const r = await this.get<PaperclipApproval[]>(`/api/companies/${companyId}/approvals`);
    if (!r.ok || !Array.isArray(r.data)) return [];
    return r.data.filter((a) => (a.status ?? "").toLowerCase() === "pending");
  }

  async getActivity(companyId: string, limit = 20): Promise<unknown[]> {
    const r = await this.get<unknown[]>(`/api/companies/${companyId}/activity?limit=${limit}`);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }

  async search(companyId: string, query: string, limit = 12): Promise<unknown[]> {
    const qs = new URLSearchParams({ query, limit: String(limit) }).toString();
    const r = await this.get<unknown[] | { results?: unknown[] }>(
      `/api/companies/${companyId}/search?${qs}`,
    );
    if (!r.ok || !r.data) return [];
    if (Array.isArray(r.data)) return r.data;
    return r.data.results ?? [];
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const t0 = Date.now();
    const r = await this.get("/api/companies", 3000);
    return { ok: r.ok, latencyMs: Date.now() - t0, error: r.error };
  }

  private async get<T>(path: string, timeoutMs = 6000): Promise<ApiResult<T>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "agent-platform-console/1.0",
        },
        signal: ctrl.signal,
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, status: res.status, data: null, error: "non-json" };
      }
      return { ok: res.ok, status: res.status, data: parsed as T };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const paperclipApi = new PaperclipApiClient();
