import { HERMES_BASE } from "../config.ts";

export interface HermesGatewayPlatform {
  connected?: boolean;
  state?: string;
  users?: number;
  error?: string | null;
  last_message_at?: string | null;
}

export interface HermesStatusResponse {
  version: string;
  release_date: string;
  config_version: number;
  latest_config_version: number;
  gateway_running: boolean;
  gateway_pid: number | null;
  gateway_state: string;
  gateway_platforms: Record<string, HermesGatewayPlatform>;
  gateway_exit_reason: string | null;
  gateway_updated_at: string | null;
  active_sessions: number;
}

export interface HermesCronJob {
  id: string;
  name: string;
  prompt?: string;
  schedule: string;
  paused?: boolean;
  next_run?: string | null;
  last_run?: string | null;
  last_exit_code?: number | null;
  last_output_path?: string | null;
  deliver?: string;
}

export interface HermesAnalyticsDaily {
  day: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  sessions: number;
  api_calls: number;
}

export interface HermesAnalytics {
  daily: HermesAnalyticsDaily[];
  by_model: { model: string; input_tokens: number; output_tokens: number; estimated_cost: number; sessions: number; api_calls: number }[];
  totals: {
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_reasoning: number;
    total_estimated_cost: number;
    total_actual_cost: number;
    total_sessions: number;
    total_api_calls: number;
  };
  period_days: number;
}

let cachedToken: string | null = null;
let cachedTokenAt = 0;
const TOKEN_TTL_MS = 60_000;

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

class HermesApiClient {
  private base = HERMES_BASE;

  private async fetchToken(): Promise<string | null> {
    if (cachedToken && Date.now() - cachedTokenAt < TOKEN_TTL_MS) return cachedToken;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const res = await fetch(`${this.base}/`, {
          headers: { Accept: "text/html" },
          signal: ctrl.signal,
        });
        if (!res.ok) return cachedToken;
        const html = await res.text();
        const m = html.match(/__HERMES_SESSION_TOKEN__\s*=\s*"([A-Za-z0-9_-]+)"/);
        if (m) {
          cachedToken = m[1];
          cachedTokenAt = Date.now();
          return cachedToken;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // fall through
    }
    return cachedToken;
  }

  async getStatus(): Promise<HermesStatusResponse | null> {
    const r = await this.get<HermesStatusResponse>("/api/status", false);
    return r.ok ? r.data : null;
  }

  async getCronJobs(): Promise<HermesCronJob[]> {
    const r = await this.get<HermesCronJob[] | { jobs?: HermesCronJob[] }>("/api/cron/jobs", true);
    if (!r.ok || !r.data) return [];
    return Array.isArray(r.data) ? r.data : (r.data.jobs ?? []);
  }

  async getAnalytics(): Promise<HermesAnalytics | null> {
    const r = await this.get<HermesAnalytics>("/api/analytics/usage", true);
    return r.ok ? r.data : null;
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const t0 = Date.now();
    const r = await this.get("/api/status", false, 3000);
    return { ok: r.ok, latencyMs: Date.now() - t0, error: r.error };
  }

  private async get<T>(
    path: string,
    auth: boolean,
    timeoutMs = 6000,
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "agent-platform-console/1.0",
    };
    if (auth) {
      const tok = await this.fetchToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res = await fetch(`${this.base}${path}`, { headers, signal: ctrl.signal });
      if (auth && res.status === 401) {
        cachedToken = null;
        const fresh = await this.fetchToken();
        if (fresh) {
          headers.Authorization = `Bearer ${fresh}`;
          res = await fetch(`${this.base}${path}`, { headers, signal: ctrl.signal });
        }
      }
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

export const hermesApi = new HermesApiClient();
