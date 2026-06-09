// Central registry for event-kind display names shown in Console feeds.
// Producers should register plain-English names here instead of relying on
// raw workflow/event kind strings leaking into the UI.

export type EventDisplaySource = "alert" | "approval" | "codex" | "heartbeat" | "tokens" | "burst" | "platform";

export const EVENT_DISPLAY_NAMES: Record<string, string> = {
  // Producer event kinds.
  "claude-code-session-ended": "Claude Code wrapped a coding session",
  "codex-pool-quarantined": "Codex pool quarantined a worker",

  // SSE/feed event kinds.
  "alert-created": "Platform alert opened",
  "alert-resolved": "Platform alert resolved",
  "approval-created": "Approval requested",
  "approval-decided": "Approval decided",
  "codex-worker-quarantine": "Codex worker quarantined",
  heartbeat: "Agent heartbeat",
  "cost-tick": "Cost telemetry updated",
  "token-burst": "Token burst",

  // Internal feed item kinds.
  alert: "Platform alert",
  approval: "Approval request",
  codex: "Codex worker event",
  tokens: "Token activity",
  burst: "Token burst",

  // AlertKind values from lib/alerts.ts.
  "stuck-agent": "Agent heartbeat went stale",
  "approval-pending": "Approval waiting on DJ",
  "cron-failed": "Cron job failed",
  "budget-forecast": "Budget forecast crossed threshold",
  "backup-stale": "Backup is stale",
  "domain-expiring": "Domain is nearing expiration",
  "vps-action-stuck": "VPS action is stuck",
  "upstream-down": "Upstream service is down",
  "gateway-down": "Hermes gateway is down",
};

const UNCLASSIFIED_EVENT_NAME = "Unclassified event";

function normalizeEventKind(kind: string): string {
  return kind
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function classifyEventSource(source?: EventDisplaySource): string {
  switch (source) {
    case "alert":
      return "Platform alert";
    case "approval":
      return "Approval request";
    case "codex":
      return "Codex worker event";
    case "heartbeat":
      return "Agent heartbeat";
    case "tokens":
      return "Token activity";
    case "burst":
      return "Token burst";
    case "platform":
    case undefined:
      return "Platform event";
  }
}

export function registerEventDisplayName(kind: string, displayName: string): void {
  const normalizedKind = normalizeEventKind(kind);
  const trimmedDisplayName = displayName.trim();
  if (!normalizedKind) {
    throw new Error("event kind is required");
  }
  if (!trimmedDisplayName || trimmedDisplayName.toLowerCase() === "unknown") {
    throw new Error("event display name must be plain-English and cannot be 'unknown'");
  }
  EVENT_DISPLAY_NAMES[normalizedKind] = trimmedDisplayName;
}

export function getRegisteredEventDisplayName(kind: string | null | undefined): string | undefined {
  const normalizedKind = normalizeEventKind(kind ?? "");
  if (!normalizedKind || normalizedKind === "unknown") return undefined;
  return EVENT_DISPLAY_NAMES[normalizedKind];
}

export function resolveEventDisplayName(
  kind: string | null | undefined,
  options: { source?: EventDisplaySource } = {},
): string {
  const normalizedKind = normalizeEventKind(kind ?? "");
  if (!normalizedKind || normalizedKind === "unknown") return UNCLASSIFIED_EVENT_NAME;
  return EVENT_DISPLAY_NAMES[normalizedKind] ?? classifyEventSource(options.source);
}
