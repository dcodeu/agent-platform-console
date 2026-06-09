// display.ts — user-facing copy normalization for raw backend values.
//
// Backend identifiers stay unchanged for queries, filters, and routing. These
// helpers are only for labels rendered in the UI so snake_case, event ids,
// terse source names, and unknown fallbacks do not leak into the dashboard.

import { getRegisteredEventDisplayName } from "../../../lib/event-display-names.ts";

const EXACT_LABELS: Record<string, string> = {
  "": "Not reported",
  unknown: "Not reported",
  "(unknown)": "Not reported",
  none: "None",
  "(none)": "None",
  null: "Not reported",
  undefined: "Not reported",
  all: "All",
  lifetime: "All time",

  n8n: "Automations",
  imessage: "iMessage",
  ime: "iMessage",
  hermes: "Hermes",
  paperclip: "Paperclip",
  codex: "Codex",
  "codex-pool": "Codex pool",
  postgres: "Database metrics",
  pg: "Database metrics",
  prom: "Server metrics",
  loki: "Log search",
  kuma: "Monitor checks",
  docker: "Container status",
  upstream: "Monitor checks",
  snapshot: "Live snapshot",
  sse: "Live stream",

  mtd: "month to date",
  "24h": "last 24 hours",
  "30d": "last 30 days",
  "14d": "last 14 days",
  "7d": "last 7 days",
  "6h": "last 6 hours",
  "1h": "last hour",
  live: "live now",
  instant: "live now",
  daily: "daily",
  hourly: "hourly",

  ok: "Healthy",
  warn: "Needs attention",
  alert: "Critical",
  info: "Info",
  idle: "Idle",
  ready: "Ready",
  valid: "Ready",
  invalid: "Needs login",
  quar: "Quarantined",
  quarantined: "Quarantined",
  quarantine: "quarantined",
  unquarantine: "back in rotation",
  running: "Running",
  success: "Succeeded",
  error: "Failed",
  failed: "Failed",
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
  cancelled: "Cancelled",
  decided: "Decided",

  input: "Input tokens",
  output: "Output tokens",
  cache: "Cache reads",
  cache_read: "Cache reads",
  calls: "Calls",
};

const ACRONYMS: Record<string, string> = {
  api: "API",
  apm: "APM",
  cpu: "CPU",
  db: "DB",
  dns: "DNS",
  http: "HTTP",
  https: "HTTPS",
  id: "ID",
  ip: "IP",
  json: "JSON",
  mcp: "MCP",
  mtd: "MTD",
  pg: "Postgres",
  p50: "p50",
  p95: "p95",
  p99: "p99",
  sse: "SSE",
  sql: "SQL",
  ui: "UI",
  url: "URL",
  vps: "VPS",
};

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeKey(value: string | null | undefined): string {
  return clean(value).toLowerCase().replace(/[\s_]+/g, "-");
}

function titleize(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "Not reported";
  return words
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (/^p\d+$/i.test(word)) return lower;
      if (/^\d+[hdms]$/i.test(word)) return displayLabel(word);
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function displayLabel(value: string | null | undefined): string {
  const raw = clean(value);
  const key = normalizeKey(raw);
  if (EXACT_LABELS[key]) return EXACT_LABELS[key];
  if (EXACT_LABELS[raw]) return EXACT_LABELS[raw];
  const eventName = getRegisteredEventDisplayName(raw);
  if (eventName) return eventName;
  const lastWindow = raw.match(/^last\s+(\d+[hdms])$/i);
  if (lastWindow) return displayLabel(lastWindow[1]);
  return titleize(raw);
}

export function displaySourceLabel(value: string | null | undefined): string {
  const raw = clean(value);
  if (!raw) return "Source not reported";
  const compact = raw.toLowerCase().replace(/[\s_]+/g, "-");
  if (compact === "pg-stat-activity") return "Live database activity";
  if (compact === "lifetime") return "All recorded activity";
  return raw
    .split(/\s*[·|/]\s*/g)
    .map((part) => displayLabel(part))
    .join(" · ");
}

export function displayStatusLabel(value: string | null | undefined): string {
  return displayLabel(value);
}

export function displayMetricLabel(value: string | null | undefined): string {
  return displayLabel(value);
}

export function displayEventLabel(value: string | null | undefined): string {
  return getRegisteredEventDisplayName(value) ?? displayLabel(value);
}

export function displayWorkflowLabel(value: string | null | undefined): string {
  return getRegisteredEventDisplayName(value) ?? displayLabel(value);
}

export function displayWorkerState(value: string | null | undefined, enabled = true): string {
  if (!enabled) return "Disabled";
  return displayStatusLabel(value);
}
