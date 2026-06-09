import { DEFAULT_COMPANY_ID } from "../config.ts";
import {
  paperclipApi,
  type PaperclipAgent,
  type PaperclipCompany,
  type PaperclipCostByAgent,
  type PaperclipCostByModel,
  type PaperclipCostByProvider,
  type PaperclipCostsSummary,
  type PaperclipHeartbeat,
  type PaperclipApproval,
} from "./paperclip-api.ts";
import {
  hermesApi,
  type HermesAnalytics,
  type HermesCronJob,
  type HermesStatusResponse,
} from "./hermes-api.ts";
import { hostinger, type FirewallGroup, type SshKey, type VpsAction } from "./hostinger.ts";
import { recordProbe, getUpstreamHealth, type UpstreamHealth } from "./upstream.ts";
import { buildAlerts, type Alert } from "./alerts.ts";
import { getSnapshot } from "./snapshot.ts";
import {
  collectImessageFeed,
  collectTokensFeed,
  type ImessageFeed,
  type TokensFeed,
} from "./feeds.ts";

export interface AgentRosterTile {
  id: string;
  name: string;
  role: string;
  status: string;
  lastHeartbeatAt: string | null;
  ageSec: number | null;
  spentMonthlyCents: number;
  budgetMonthlyCents: number;
  budgetPct: number;
  currentRunId?: string | null;
  stuck: boolean;
  model?: string;
}

export interface ActivityFeedItem {
  id: string;
  agentName: string;
  role: string;
  companyName: string;
  status: string;
  lastHeartbeatAt: string | null;
  ageSec: number | null;
  stuck: boolean;
}

export interface CostBreakdown {
  today: { dollars: number; tokens: number };
  mtd: { dollars: number; tokens: number };
  forecastMonthDollars: number;
  budgetCents: number;
  spentCents: number;
  budgetPct: number;
  byProvider: { provider: string; dollars: number }[];
  byAgent: { agentName: string; dollars: number }[];
  byModel: { model: string; dollars: number }[];
}

export interface HeavySnapshot {
  generatedAt: number;
  activeCompanyId: string;
  companies: PaperclipCompany[];
  heartbeats: PaperclipHeartbeat[];
  approvalsPending: PaperclipApproval[];
  agentRoster: AgentRosterTile[];
  activityFeed: ActivityFeedItem[];
  costs: CostBreakdown;
  paperclipCostsSummary: PaperclipCostsSummary | null;
  hermes: {
    status: HermesStatusResponse | null;
    analytics: HermesAnalytics | null;
    cronJobs: HermesCronJob[];
    failedCrons: HermesCronJob[];
  };
  hostinger: {
    firewall: FirewallGroup | null;
    sshKeys: SshKey[];
    pendingActions: VpsAction[];
  };
  upstream: UpstreamHealth[];
  alerts: Alert[];
  imessage: ImessageFeed;
  tokens: TokensFeed;
}

let cached: HeavySnapshot | null = null;
let cachedAt = 0;
const TTL_MS = 60_000;

export async function getHeavySnapshot(force = false): Promise<HeavySnapshot> {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;

  const companyId = DEFAULT_COMPANY_ID;

  const [companies, heartbeats, agents, approvals, costSummary, costsByAgent, costsByProvider, costsByModel] =
    await Promise.all([
      timed(() => paperclipApi.listCompanies(), "paperclip", () => []),
      timed(() => paperclipApi.getHeartbeats(), "paperclip", () => []),
      timed(() => paperclipApi.getAgents(companyId), "paperclip", () => []),
      timed(() => paperclipApi.getApprovalsPending(companyId), "paperclip", () => []),
      timed(() => paperclipApi.getCostsSummary(companyId), "paperclip", () => null),
      timed(() => paperclipApi.getCostsByAgent(companyId), "paperclip", () => []),
      timed(() => paperclipApi.getCostsByProvider(companyId), "paperclip", () => []),
      timed(() => paperclipApi.getCostsByModel(companyId), "paperclip", () => []),
    ]);

  const [hermesStatus, hermesAnalytics, hermesCronJobs, imessageFeed] = await Promise.all([
    timed(() => hermesApi.getStatus(), "hermes", () => null),
    timed(() => hermesApi.getAnalytics(), "hermes", () => null),
    timed(() => hermesApi.getCronJobs(), "hermes", () => []),
    timed(
      () => collectImessageFeed(),
      "imessage",
      () => ({
        recent: [],
        last24h: { in: 0, out: 0, failed: 0 },
        lastInboundAt: null,
        lastOutboundAt: null,
        note: "imessage collector failed",
      }),
    ),
  ]);

  const tokensFeed = await timed(
    () => collectTokensFeed(hermesAnalytics, { agents, heartbeats }),
    "tokens",
    () => ({
      mtd: { input: 0, output: 0, cache_read: 0, reasoning: 0, total: 0 },
      today: { input: 0, output: 0, cache_read: 0, reasoning: 0, total: 0 },
      daily: [],
      bySource: [],
      byModel: [],
      byAgent: [],
      cacheReadRatio: 0,
      note: "tokens collector failed",
    }),
  );

  const baseSnap = await getSnapshot();
  const vmId = baseSnap.hostinger.vm?.id;
  const firewallGroupId = baseSnap.hostinger.vm?.firewallGroupId;

  const [firewall, sshKeys, vpsActions] = await Promise.all([
    hostinger.configured() && firewallGroupId
      ? timed(() => hostinger.firewallGroup(firewallGroupId), "hostinger", () => null)
      : Promise.resolve(null as FirewallGroup | null),
    hostinger.configured()
      ? timed(() => hostinger.sshKeys(), "hostinger", () => [] as SshKey[])
      : Promise.resolve([] as SshKey[]),
    hostinger.configured() && vmId
      ? timed(() => hostinger.vpsActions(vmId), "hostinger", () => [] as VpsAction[])
      : Promise.resolve([] as VpsAction[]),
  ]);

  const pendingActions = vpsActions.filter((a) => {
    const s = (a.state ?? "").toLowerCase();
    return s === "pending" || s === "in_progress" || s === "running";
  });

  const agentRoster = buildRoster(agents, heartbeats, costsByAgent);
  const activityFeed = buildActivityFeed(heartbeats);
  const costs = buildCostBreakdown(costSummary, costsByAgent, costsByProvider, costsByModel, hermesAnalytics);
  const failedCrons = hermesCronJobs.filter(
    (j) => typeof j.last_exit_code === "number" && j.last_exit_code !== 0,
  );

  const upstream = getUpstreamHealth();

  const alerts = buildAlerts({
    heartbeats,
    approvals,
    cronJobs: hermesCronJobs,
    hermesStatus,
    backups: baseSnap.hostinger.backups,
    domains: baseSnap.hostinger.domains,
    vpsActions: pendingActions,
    upstreamHealth: upstream,
  });

  cached = {
    generatedAt: Date.now(),
    activeCompanyId: companyId,
    companies,
    heartbeats,
    approvalsPending: approvals,
    agentRoster,
    activityFeed,
    costs,
    paperclipCostsSummary: costSummary,
    hermes: {
      status: hermesStatus,
      analytics: hermesAnalytics,
      cronJobs: hermesCronJobs,
      failedCrons,
    },
    hostinger: { firewall, sshKeys, pendingActions },
    upstream,
    alerts,
    imessage: imessageFeed,
    tokens: tokensFeed,
  };
  cachedAt = Date.now();
  return cached;
}

async function timed<T>(
  fn: () => Promise<T>,
  upstreamName: string,
  fallback: () => T,
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    recordProbe(upstreamName, { ok: true, latencyMs: Date.now() - t0 });
    return r;
  } catch (e) {
    recordProbe(upstreamName, {
      ok: false,
      latencyMs: Date.now() - t0,
      error: (e as Error).message,
    });
    return fallback();
  }
}

function buildRoster(
  agents: PaperclipAgent[],
  heartbeats: PaperclipHeartbeat[],
  costsByAgent: PaperclipCostByAgent[],
): AgentRosterTile[] {
  const hbByAgentId = new Map(heartbeats.map((hb) => [hb.id, hb]));
  const costByAgentId = new Map(costsByAgent.map((c) => [c.agentId, c]));
  const now = Date.now();
  return agents.map((a) => {
    const hb = hbByAgentId.get(a.id);
    const cost = costByAgentId.get(a.id);
    const lastAt = hb?.lastHeartbeatAt ?? null;
    const ageSec = lastAt ? Math.floor((now - Date.parse(lastAt)) / 1000) : null;
    const intervalMs = (hb?.intervalSec ?? 300) * 1000;
    const stuck = !!(hb?.heartbeatEnabled && lastAt && now - Date.parse(lastAt) > intervalMs * 3);
    const budgetCents = 0;
    const spentCents = cost?.costCents ?? 0;
    const budgetPct = budgetCents > 0 ? (spentCents / budgetCents) * 100 : 0;
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      lastHeartbeatAt: lastAt,
      ageSec,
      spentMonthlyCents: spentCents,
      budgetMonthlyCents: budgetCents,
      budgetPct,
      currentRunId: hb?.runId ?? null,
      stuck,
      model: a.adapterConfig?.model as string | undefined,
    };
  });
}

function buildActivityFeed(heartbeats: PaperclipHeartbeat[]): ActivityFeedItem[] {
  const now = Date.now();
  return [...heartbeats]
    .filter((h) => h.lastHeartbeatAt)
    .sort(
      (a, b) =>
        Date.parse(b.lastHeartbeatAt ?? "0") - Date.parse(a.lastHeartbeatAt ?? "0"),
    )
    .slice(0, 8)
    .map((hb) => {
      const at = hb.lastHeartbeatAt ? Date.parse(hb.lastHeartbeatAt) : null;
      const ageSec = at ? Math.floor((now - at) / 1000) : null;
      const intervalMs = (hb.intervalSec ?? 300) * 1000;
      const stuck = !!(hb.heartbeatEnabled && at && now - at > intervalMs * 3);
      return {
        id: hb.id,
        agentName: hb.agentName,
        role: hb.role,
        companyName: hb.companyName,
        status: hb.status,
        lastHeartbeatAt: hb.lastHeartbeatAt,
        ageSec,
        stuck,
      };
    });
}

function buildCostBreakdown(
  summary: PaperclipCostsSummary | null,
  byAgent: PaperclipCostByAgent[],
  byProvider: PaperclipCostByProvider[],
  byModel: PaperclipCostByModel[],
  hermesAnalytics: HermesAnalytics | null,
): CostBreakdown {
  const spentCents = summary?.spendCents ?? 0;
  const budgetCents = summary?.budgetCents ?? 0;
  const budgetPct = summary?.utilizationPercent ?? 0;

  const hermesDollars = hermesAnalytics?.totals.total_estimated_cost ?? 0;
  const todayDollars = (hermesAnalytics?.daily[hermesAnalytics.daily.length - 1]?.estimated_cost ?? 0);
  const mtdDollars = spentCents / 100 + hermesDollars;

  const dayOfMonth = new Date().getUTCDate();
  const daysRemaining = Math.max(1, 30 - dayOfMonth);
  const dailyRate = dayOfMonth > 0 ? mtdDollars / dayOfMonth : 0;
  const forecastMonthDollars = mtdDollars + dailyRate * daysRemaining;

  return {
    today: {
      dollars: todayDollars,
      tokens:
        (hermesAnalytics?.daily[hermesAnalytics.daily.length - 1]?.input_tokens ?? 0) +
        (hermesAnalytics?.daily[hermesAnalytics.daily.length - 1]?.output_tokens ?? 0),
    },
    mtd: {
      dollars: mtdDollars,
      tokens:
        (hermesAnalytics?.totals.total_input ?? 0) + (hermesAnalytics?.totals.total_output ?? 0),
    },
    forecastMonthDollars,
    budgetCents,
    spentCents,
    budgetPct,
    byProvider: byProvider.map((p) => ({ provider: p.provider, dollars: p.costCents / 100 })),
    byAgent: byAgent.map((a) => ({ agentName: a.agentName, dollars: a.costCents / 100 })),
    byModel: byModel.map((m) => ({ model: m.model, dollars: m.costCents / 100 })),
  };
}
