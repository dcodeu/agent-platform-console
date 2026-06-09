import type { LokiEntry } from "../widgets/useNativeData.ts";

const ALL_LOGS_SELECTOR = '{job=~".+"}';
const SOURCE_LABEL_KEYS = ["source", "job", "container", "unit", "service_name", "app"] as const;

export function logSourceFor(labels: Record<string, string>): string {
  for (const key of SOURCE_LABEL_KEYS) {
    const value = labels[key]?.trim();
    if (value) return value;
  }
  return "unknown";
}

export function buildSourceOptions(entries: readonly LokiEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => logSourceFor(entry.labels)))).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export function filterBySelectedSources<T extends { labels: Record<string, string> }>(
  entries: readonly T[],
  selectedSources: ReadonlySet<string>,
): T[] {
  if (selectedSources.size === 0) return entries.slice();
  return entries.filter((entry) => selectedSources.has(logSourceFor(entry.labels)));
}

export function buildLogql(search: string): string {
  const trimmed = search.trim();
  if (trimmed.length === 0) return ALL_LOGS_SELECTOR;
  const safe = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${ALL_LOGS_SELECTOR} |~ "${safe}"`;
}
