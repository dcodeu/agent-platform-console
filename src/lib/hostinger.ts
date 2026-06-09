import { HOSTINGER_BASE, hostingerToken } from "../config.ts";

export interface HostingerStatus {
  configured: boolean;
  ok: boolean;
  reason?: string;
}

export interface IpRecord {
  id: number;
  address: string;
  ptr?: string;
}

export interface VirtualMachine {
  id: number;
  hostname: string;
  state: string;
  plan: string;
  cpus: number;
  memoryMb: number;
  diskMb: number;
  bandwidthMb: number;
  ipv4: IpRecord[];
  ipv6: IpRecord[];
  template: { id: number; name: string; description?: string };
  dataCenterId: number;
  subscriptionId: string;
  firewallGroupId: number | null;
  actionsLock: string;
  createdAt: string;
  ns1?: string;
  ns2?: string;
}

export interface MetricSeries {
  unit: string;
  points: { t: number; v: number }[];
  last: number | null;
  first: number | null;
  min: number | null;
  max: number | null;
}

export interface VmMetrics {
  cpuPct: MetricSeries;
  ramBytes: MetricSeries;
  diskBytes: MetricSeries;
  netInBytes: MetricSeries;
  netOutBytes: MetricSeries;
  uptimeSeconds: MetricSeries;
  windowStart: string;
  windowEnd: string;
}

export interface Backup {
  id: number;
  size: number;
  restore_time: number;
  location: string;
  created_at: string;
}

export interface DataCenter {
  id: number;
  name: string;
  location: string;
  city: string;
  continent: string;
}

export interface Subscription {
  id: string;
  name: string;
  status: string;
  billing_period: number;
  billing_period_unit: string;
  currency_code: string;
  total_price: number;
  renewal_price: number;
  is_auto_renewed: boolean;
  created_at: string;
  expires_at: string | null;
  next_billing_at: string | null;
}

export interface Domain {
  id: number;
  domain: string | null;
  type: string;
  status: string;
  created_at: string;
  expires_at: string | null;
}

export interface FirewallRule {
  id: number;
  protocol?: string;
  port?: string;
  source?: string;
  source_detail?: string;
  action?: string;
}

export interface FirewallGroup {
  id: number;
  name: string;
  rules: FirewallRule[];
  is_synced?: boolean;
}

export interface SshKey {
  id: number;
  name: string;
  key: string;
  fingerprint?: string;
  created_at?: string;
}

export interface VpsAction {
  id: number;
  name?: string;
  state?: string;
  action?: string;
  created_at?: string;
  completed_at?: string | null;
}

class HostingerClient {
  private base = HOSTINGER_BASE;

  private headers(): Record<string, string> | null {
    const t = hostingerToken();
    if (!t) return null;
    return {
      Authorization: `Bearer ${t}`,
      Accept: "application/json",
      "User-Agent": "agent-platform-console/1.0",
    };
  }

  configured(): boolean {
    return this.headers() !== null;
  }

  async listVms(): Promise<VirtualMachine[]> {
    const r = await this.fetchJson<unknown>("/vps/v1/virtual-machines");
    if (!r.ok || !Array.isArray(r.data)) return [];
    return r.data.map(normalizeVm);
  }

  async getVm(id: number | string): Promise<VirtualMachine | null> {
    const r = await this.fetchJson<unknown>(`/vps/v1/virtual-machines/${id}`);
    if (!r.ok) return null;
    return normalizeVm(r.data);
  }

  async metrics(id: number | string, hoursBack = 6): Promise<VmMetrics | null> {
    const now = new Date();
    const from = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
    const qs = new URLSearchParams({ date_from: fmt(from), date_to: fmt(now) }).toString();
    const r = await this.fetchJson<RawMetrics>(`/vps/v1/virtual-machines/${id}/metrics?${qs}`);
    if (!r.ok) return null;
    const raw = r.data;
    return {
      cpuPct: toSeries(raw.cpu_usage),
      ramBytes: toSeries(raw.ram_usage),
      diskBytes: toSeries(raw.disk_space),
      netInBytes: toSeries(raw.incoming_traffic),
      netOutBytes: toSeries(raw.outgoing_traffic),
      uptimeSeconds: toSeries(raw.uptime),
      windowStart: fmt(from),
      windowEnd: fmt(now),
    };
  }

  async backups(id: number | string): Promise<Backup[]> {
    const r = await this.fetchJson<{ data?: Backup[] }>(`/vps/v1/virtual-machines/${id}/backups`);
    if (!r.ok) return [];
    return r.data?.data ?? [];
  }

  async dataCenters(): Promise<DataCenter[]> {
    const r = await this.fetchJson<DataCenter[]>("/vps/v1/data-centers");
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }

  async subscriptions(): Promise<Subscription[]> {
    const r = await this.fetchJson<Subscription[]>("/billing/v1/subscriptions");
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }

  async domains(): Promise<Domain[]> {
    const r = await this.fetchJson<Domain[]>("/domains/v1/portfolio");
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }

  async firewallGroup(id: number | string): Promise<FirewallGroup | null> {
    const r = await this.fetchJson<FirewallGroup>(`/vps/v1/firewall/${id}`);
    if (!r.ok || !r.data) return null;
    const fg = r.data as FirewallGroup;
    if (!Array.isArray(fg.rules)) fg.rules = [];
    return fg;
  }

  async sshKeys(): Promise<SshKey[]> {
    const r = await this.fetchJson<SshKey[]>("/vps/v1/public-keys");
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }

  async vpsActions(id: number | string): Promise<VpsAction[]> {
    const r = await this.fetchJson<VpsAction[] | { data?: VpsAction[] }>(
      `/vps/v1/virtual-machines/${id}/actions`,
    );
    if (!r.ok || !r.data) return [];
    return Array.isArray(r.data) ? r.data : (r.data.data ?? []);
  }

  async ping(): Promise<HostingerStatus> {
    if (!this.configured()) return { configured: false, ok: false, reason: "no_token" };
    const r = await this.fetchJson("/vps/v1/virtual-machines");
    return { configured: true, ok: r.ok, reason: r.ok ? undefined : `HTTP ${r.status}` };
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; data: T }> {
    const h = this.headers();
    if (!h) return { ok: false, status: 0, data: null as T };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { ...h, ...(init.headers ?? {}) },
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        // keep as text
      }
      return { ok: res.ok, status: res.status, data: data as T };
    } catch (e) {
      return { ok: false, status: 0, data: { error: (e as Error).message } as unknown as T };
    } finally {
      clearTimeout(t);
    }
  }
}

interface RawSeries {
  unit: string;
  usage: Record<string, number>;
}

interface RawMetrics {
  cpu_usage: RawSeries;
  ram_usage: RawSeries;
  disk_space: RawSeries;
  outgoing_traffic: RawSeries;
  incoming_traffic: RawSeries;
  uptime: RawSeries;
}

function toSeries(raw: RawSeries | undefined): MetricSeries {
  if (!raw || !raw.usage) {
    return { unit: "", points: [], last: null, first: null, min: null, max: null };
  }
  const points = Object.entries(raw.usage)
    .map(([t, v]) => ({ t: Number(t), v: Number(v) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (points.length === 0) {
    return { unit: raw.unit ?? "", points: [], last: null, first: null, min: null, max: null };
  }
  const vals = points.map((p) => p.v);
  return {
    unit: raw.unit ?? "",
    points,
    first: vals[0],
    last: vals[vals.length - 1],
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

function normalizeVm(raw: unknown): VirtualMachine {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ipv4 = (r.ipv4 as IpRecord[]) ?? [];
  const ipv6 = (r.ipv6 as IpRecord[]) ?? [];
  return {
    id: Number(r.id ?? 0),
    hostname: String(r.hostname ?? ""),
    state: String(r.state ?? "unknown"),
    plan: String(r.plan ?? ""),
    cpus: Number(r.cpus ?? 0),
    memoryMb: Number(r.memory ?? 0),
    diskMb: Number(r.disk ?? 0),
    bandwidthMb: Number(r.bandwidth ?? 0),
    ipv4,
    ipv6,
    template: (r.template as VirtualMachine["template"]) ?? { id: 0, name: "" },
    dataCenterId: Number(r.data_center_id ?? 0),
    subscriptionId: String(r.subscription_id ?? ""),
    firewallGroupId: r.firewall_group_id == null ? null : Number(r.firewall_group_id),
    actionsLock: String(r.actions_lock ?? ""),
    createdAt: String(r.created_at ?? ""),
    ns1: r.ns1 ? String(r.ns1) : undefined,
    ns2: r.ns2 ? String(r.ns2) : undefined,
  };
}

export const hostinger = new HostingerClient();
