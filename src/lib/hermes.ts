import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { ROOT } from "../config.ts";
import { run } from "./shell.ts";

const DATA = `${ROOT}/data/hermes`;

export interface HermesSchedule {
  name: string;
  schedule: string;
  enabled: boolean;
  nextRunUtc?: string;
  lastRunUtc?: string;
  lastResult?: string;
}

export interface HermesSummary {
  id: string;
  topic: string;
  createdAt: string;
  excerpt: string;
}

export interface HermesStatus {
  installed: boolean;
  dashboardUnitActive: "active" | "inactive" | "failed" | "unknown";
  dashboardUrl: string;
  schedules: HermesSchedule[];
  recentSummaries: HermesSummary[];
  memoryFiles: number;
  lastEventAt?: string;
}

export async function hermesStatus(): Promise<HermesStatus> {
  const r = await run("systemctl", ["--user", "is-active", "hermes-dashboard.service"], { timeoutMs: 1500 });
  const v = r.stdout.trim();
  const dashboardUnitActive =
    v === "active" ? "active" : v === "failed" ? "failed" : v === "inactive" ? "inactive" : "unknown";
  return {
    installed: existsSync(DATA),
    dashboardUnitActive,
    dashboardUrl: "https://hermes.hawilson.xyz",
    schedules: readSchedules(),
    recentSummaries: readSummaries(),
    memoryFiles: countDir(`${DATA}/memory`),
    lastEventAt: lastEventTime(),
  };
}

function readSchedules(): HermesSchedule[] {
  const dir = `${DATA}/schedules`;
  if (!existsSync(dir)) return [];
  const out: HermesSchedule[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    try {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      out.push({
        name: pick(text, "name") ?? file.replace(/\.ya?ml$/, ""),
        schedule: pick(text, "schedule") ?? pick(text, "cron") ?? "—",
        enabled: !/^\s*enabled\s*:\s*false/m.test(text),
        nextRunUtc: pick(text, "next_run") ?? pick(text, "next_run_utc"),
        lastRunUtc: pick(text, "last_run") ?? pick(text, "last_run_utc"),
        lastResult: pick(text, "last_result"),
      });
    } catch {
      // skip
    }
  }
  return out;
}

function readSummaries(limit = 5): HermesSummary[] {
  const dir = `${DATA}/summaries`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
    .map((f) => ({ f, t: statSync(`${dir}/${f}`).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit)
    .map(({ f }) => {
      const full = readFileSync(`${dir}/${f}`, "utf8");
      const firstLine = full.split("\n").find((l) => l.trim()) ?? "";
      const topic = firstLine.replace(/^#+\s*/, "").slice(0, 80);
      const excerpt = full.split("\n").slice(0, 8).join(" ").slice(0, 200);
      return {
        id: f.replace(/\.(md|txt)$/, ""),
        topic,
        createdAt: new Date(statSync(`${dir}/${f}`).mtimeMs).toISOString(),
        excerpt,
      };
    });
}

function pick(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "m"));
  if (!m) return undefined;
  return m[1].replace(/^['"]|['"]$/g, "");
}

function countDir(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => !f.startsWith(".")).length;
  } catch {
    return 0;
  }
}

function lastEventTime(): string | undefined {
  const dirs = [`${DATA}/summaries`, `${DATA}/state`, `${DATA}/memory`];
  let max = 0;
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      try {
        const t = statSync(`${d}/${f}`).mtimeMs;
        if (t > max) max = t;
      } catch {
        // ignore
      }
    }
  }
  return max > 0 ? new Date(max).toISOString() : undefined;
}
