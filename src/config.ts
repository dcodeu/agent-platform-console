export const ROOT = "/opt/agent-platform";
export const BIN = `${ROOT}/runtime/bin`;
export const COMPANIES = `${ROOT}/companies`;
export const LOGS = `${ROOT}/logs`;
export const SECRETS = `${ROOT}/secrets`;

export const PORT = Number(process.env.CONSOLE_PORT ?? 8080);
export const HOST = process.env.CONSOLE_HOST ?? "127.0.0.1";

// Hostinger secrets are injected from Doppler agent-platform/prd_hostinger by
// /opt/agent-platform/runtime/bin/agent-platform-console-start. Keep these as
// env reads only; do not reintroduce local token.env file reads here.
export function hostingerToken(): string | null {
  return process.env.HOSTINGER_API_TOKEN?.trim() || null;
}

export const HOSTINGER_BASE = "https://developers.hostinger.com/api";
export const VPS_ID_HINT = process.env.HOSTINGER_VPS_ID ?? null;

export const PAPERCLIP_BASE = process.env.PAPERCLIP_BASE ?? "http://127.0.0.1:3100";
export const HERMES_BASE = process.env.HERMES_BASE ?? "http://127.0.0.1:9119";

export const DEFAULT_COMPANY_ID =
  process.env.DEFAULT_COMPANY_ID ?? "d6bb1d6a-3603-4787-9340-846df149c24d";

export const GRAFANA_BASE = process.env.GRAFANA_BASE ?? "";
export const GRAFANA_SA_TOKEN = process.env.GRAFANA_SA_TOKEN ?? "";
export const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID ?? "";
export const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET ?? "";

// ai_invocations Postgres DB — direct read access for tokens + iMessage tables.
// Injected by Doppler `prd_console`. Prefer a full postgres:// URL when present,
// otherwise derive one from the split AI_INVOCATIONS_DB_* keys shared with Python
// ledger writers.
function buildAiInvocationsDbUrl(): string {
  if (process.env.AI_INVOCATIONS_DB_URL) return process.env.AI_INVOCATIONS_DB_URL;
  const host = process.env.AI_INVOCATIONS_DB_HOST;
  const port = process.env.AI_INVOCATIONS_DB_PORT;
  const name = process.env.AI_INVOCATIONS_DB_NAME;
  const user = process.env.AI_INVOCATIONS_DB_USER;
  const password = process.env.AI_INVOCATIONS_DB_PASSWORD;
  if (!host || !port || !name || !user || !password) return "";
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
}

export const AI_INVOCATIONS_DB_URL = buildAiInvocationsDbUrl();

// Prometheus + Loki upstreams used by /api/metrics/* native query proxies.
export const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://127.0.0.1:9090";
export const LOKI_URL = process.env.LOKI_URL ?? "http://127.0.0.1:3101";

// Telegram bot — used by the approvals system to deliver inline-button
// approval prompts. Mirrors prd_hermes_gateway values; copied into prd_console
// so the console can send sendMessage directly without bouncing through
// Hermes.
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const TELEGRAM_HOME_CHANNEL = process.env.TELEGRAM_HOME_CHANNEL ?? "";
export const TELEGRAM_ALLOWED_USERS = process.env.TELEGRAM_ALLOWED_USERS ?? "";

// sendblue-send helper for iMessage outbound.
export const SENDBLUE_SEND_BIN =
  process.env.SENDBLUE_SEND_BIN ?? "/opt/agent-platform/runtime/bin/sendblue-send";

export const ALERT_THRESHOLDS = {
  stuckHeartbeatMs: Number(process.env.STUCK_HEARTBEAT_MS ?? 10 * 60 * 1000),
  approvalAgeMs: Number(process.env.APPROVAL_AGE_MS ?? 30 * 60 * 1000),
  backupWarnDays: Number(process.env.BACKUP_WARN_DAYS ?? 3),
  backupCritDays: Number(process.env.BACKUP_CRIT_DAYS ?? 7),
  domainWarnDays: Number(process.env.DOMAIN_WARN_DAYS ?? 30),
  domainCritDays: Number(process.env.DOMAIN_CRIT_DAYS ?? 14),
  vpsActionStuckMs: Number(process.env.VPS_ACTION_STUCK_MS ?? 30 * 60 * 1000),
  budgetForecastWindowDays: Number(process.env.BUDGET_WINDOW_DAYS ?? 7),
  upstreamFailureCount: Number(process.env.UPSTREAM_FAIL_COUNT ?? 2),
};
