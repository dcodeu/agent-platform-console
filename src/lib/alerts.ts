import { ALERT_THRESHOLDS } from "../config.ts";
import type { PaperclipHeartbeat, PaperclipApproval } from "./paperclip-api.ts";
import type { HermesCronJob, HermesStatusResponse } from "./hermes-api.ts";
import type { Backup, Domain, VpsAction } from "./hostinger.ts";

export type AlertSeverity = "info" | "warn" | "critical";
export type AlertKind =
  | "stuck_agent"
  | "approval_pending"
  | "cron_failed"
  | "budget_forecast"
  | "backup_stale"
  | "domain_expiring"
  | "vps_action_stuck"
  | "upstream_down"
  | "gateway_down";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  kind: AlertKind;
  title: string;
  detail?: string;
  sinceMs?: number;
  link?: string;
}

const T = ALERT_THRESHOLDS;
const DAY = 24 * 60 * 60 * 1000;

export interface AlertInputs {
  heartbeats?: PaperclipHeartbeat[];
  approvals?: PaperclipApproval[];
  cronJobs?: HermesCronJob[];
  hermesStatus?: HermesStatusResponse | null;
  backups?: Backup[];
  domains?: Domain[];
  vpsActions?: VpsAction[];
  upstreamHealth?: { name: string; ok: boolean; consecutiveFailures: number }[];
  costForecast?: { agentId: string; agentName: string; pctOfBudget: number } | null;
}

export function buildAlerts(input: AlertInputs): Alert[] {
  const alerts: Alert[] = [];
  const now = Date.now();

  for (const hb of input.heartbeats ?? []) {
    if (!hb.heartbeatEnabled || !hb.lastHeartbeatAt) continue;
    const last = Date.parse(hb.lastHeartbeatAt);
    if (!Number.isFinite(last)) continue;
    const threshold = hb.intervalSec
      ? Math.max(T.stuckHeartbeatMs, hb.intervalSec * 1000 * 2)
      : T.stuckHeartbeatMs;
    const age = now - last;
    if (age > threshold) {
      alerts.push({
        id: `stuck:${hb.id}`,
        severity: age > threshold * 2 ? "critical" : "warn",
        kind: "stuck_agent",
        title: `${hb.agentName} silent ${formatDuration(age)}`,
        detail: `${hb.companyName} · ${hb.role} · last pulse ${new Date(last).toISOString()}`,
        sinceMs: last,
      });
    }
  }

  for (const ap of input.approvals ?? []) {
    if ((ap.status ?? "").toLowerCase() !== "pending") continue;
    const requested = ap.requestedAt ? Date.parse(ap.requestedAt) : NaN;
    if (!Number.isFinite(requested)) continue;
    const age = now - requested;
    if (age >= T.approvalAgeMs) {
      alerts.push({
        id: `approval:${ap.id}`,
        severity: age > T.approvalAgeMs * 4 ? "critical" : "warn",
        kind: "approval_pending",
        title: `Approval pending ${formatDuration(age)}`,
        detail: ap.title ?? ap.issueId ?? ap.id,
        sinceMs: requested,
        link: ap.issueId ? `https://paperclip.hawilson.xyz/issues/${ap.issueId}` : undefined,
      });
    } else if (age > 0) {
      alerts.push({
        id: `approval-soft:${ap.id}`,
        severity: "info",
        kind: "approval_pending",
        title: `Approval requested ${formatDuration(age)} ago`,
        detail: ap.title ?? ap.issueId ?? ap.id,
        sinceMs: requested,
      });
    }
  }

  for (const job of input.cronJobs ?? []) {
    if (typeof job.last_exit_code === "number" && job.last_exit_code !== 0) {
      alerts.push({
        id: `cron:${job.id}`,
        severity: "critical",
        kind: "cron_failed",
        title: `Cron failed: ${job.name}`,
        detail: `exit ${job.last_exit_code}${job.last_run ? ` · ${job.last_run}` : ""}`,
      });
    }
  }

  if (input.hermesStatus && input.hermesStatus.gateway_running === false) {
    alerts.push({
      id: `gateway:down`,
      severity: "warn",
      kind: "gateway_down",
      title: `Hermes gateway not running`,
      detail: input.hermesStatus.gateway_exit_reason ?? "gateway_state: " + input.hermesStatus.gateway_state,
    });
  }

  if (input.backups && input.backups.length > 0) {
    const newest = input.backups
      .map((b) => Date.parse(b.created_at))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    if (newest) {
      const days = (now - newest) / DAY;
      if (days >= T.backupCritDays) {
        alerts.push({
          id: `backup:stale`,
          severity: "critical",
          kind: "backup_stale",
          title: `Backup ${Math.floor(days)}d old`,
          detail: new Date(newest).toISOString(),
          sinceMs: newest,
        });
      } else if (days >= T.backupWarnDays) {
        alerts.push({
          id: `backup:warn`,
          severity: "warn",
          kind: "backup_stale",
          title: `Backup ${Math.floor(days)}d old`,
          detail: new Date(newest).toISOString(),
          sinceMs: newest,
        });
      }
    }
  }

  for (const d of input.domains ?? []) {
    if (!d.expires_at) continue;
    const exp = Date.parse(d.expires_at);
    if (!Number.isFinite(exp)) continue;
    const days = (exp - now) / DAY;
    if (days <= 0) continue;
    if (days <= T.domainCritDays) {
      alerts.push({
        id: `domain:${d.id}:crit`,
        severity: "critical",
        kind: "domain_expiring",
        title: `${d.domain ?? "domain"} expires in ${Math.ceil(days)}d`,
        detail: d.expires_at,
      });
    } else if (days <= T.domainWarnDays) {
      alerts.push({
        id: `domain:${d.id}:warn`,
        severity: "warn",
        kind: "domain_expiring",
        title: `${d.domain ?? "domain"} expires in ${Math.ceil(days)}d`,
        detail: d.expires_at,
      });
    }
  }

  for (const a of input.vpsActions ?? []) {
    const state = (a.state ?? "").toLowerCase();
    if (state !== "pending" && state !== "in_progress" && state !== "running") continue;
    const started = a.created_at ? Date.parse(a.created_at) : NaN;
    if (!Number.isFinite(started)) continue;
    if (now - started > T.vpsActionStuckMs) {
      alerts.push({
        id: `vpsaction:${a.id}`,
        severity: "warn",
        kind: "vps_action_stuck",
        title: `VPS action stuck: ${a.action ?? a.name ?? a.id}`,
        detail: `started ${a.created_at}`,
        sinceMs: started,
      });
    }
  }

  for (const u of input.upstreamHealth ?? []) {
    if (!u.ok && u.consecutiveFailures >= T.upstreamFailureCount) {
      alerts.push({
        id: `upstream:${u.name}`,
        severity: "warn",
        kind: "upstream_down",
        title: `${u.name} unreachable`,
        detail: `${u.consecutiveFailures} consecutive failures`,
      });
    }
  }

  if (input.costForecast && input.costForecast.pctOfBudget >= 100) {
    alerts.push({
      id: `budget:${input.costForecast.agentId}`,
      severity: input.costForecast.pctOfBudget >= 120 ? "critical" : "warn",
      kind: "budget_forecast",
      title: `${input.costForecast.agentName} forecast ${Math.round(input.costForecast.pctOfBudget)}% of budget`,
      detail: `7-day burn rate projection`,
    });
  }

  const order: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return alerts;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
