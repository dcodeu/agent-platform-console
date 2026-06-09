export type ContainerIdentity = {
  name: string;
  image: string;
};

export type ContainerDisplayState = "Healthy" | "Restarting" | "Down" | "Paused";
export type ContainerPillState = "ok" | "warn" | "alert";

const FRIENDLY_CONTAINER_NAMES: Array<[RegExp, string]> = [
  [/\b(grafana)\b|grafana\/grafana/i, "Grafana"],
  [/\bpostgres\b|pgvector\/pgvector|postgres/i, "Postgres"],
  [/\bn8n\b|n8nio\/n8n/i, "n8n"],
  [/uptime[-_]?kuma|louislam\/uptime-kuma/i, "Uptime Kuma"],
  [/kuma[-_]?host[-_]?bridge|socat/i, "Kuma host bridge"],
  [/paperclip/i, "Paperclip"],
  [/\bprometheus\b|prom\/prometheus/i, "Prometheus"],
  [/\bloki\b|grafana\/loki/i, "Loki"],
  [/promtail|grafana\/promtail/i, "Promtail"],
  [/cadvisor|gcr\.io\/cadvisor/i, "cAdvisor"],
  [/node[-_]?exporter|prom\/node-exporter/i, "Node exporter"],
  [/postgres[-_]?exporter|postgres-exporter/i, "Postgres exporter"],
];

function titleCaseName(value: string): string {
  const cleaned = value
    .replace(/^docker[-_]/i, "")
    .replace(/[-_]\d+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();

  if (!cleaned) return "Container";
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

export function friendlyContainerName(container: ContainerIdentity): string {
  const haystack = `${container.name} ${container.image}`;
  const match = FRIENDLY_CONTAINER_NAMES.find(([pattern]) => pattern.test(haystack));
  return match?.[1] ?? titleCaseName(container.name);
}

export function friendlyContainerState(status: string): ContainerDisplayState {
  const lower = status.toLowerCase();

  if (lower.includes("restarting")) return "Restarting";
  if (lower.includes("paused")) return "Paused";
  if (
    lower.includes("unhealthy") ||
    lower.includes("exited") ||
    lower.includes("dead") ||
    lower.includes("created") ||
    lower.includes("removing")
  ) {
    return "Down";
  }
  return "Healthy";
}

export function containerPillState(status: string): ContainerPillState {
  const state = friendlyContainerState(status);
  if (state === "Healthy") return "ok";
  if (state === "Down") return "alert";
  return "warn";
}
