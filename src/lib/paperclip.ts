import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { ROOT } from "../config.ts";
import { run } from "./shell.ts";

const APP = `${ROOT}/apps/paperclip`;
const LOGDIR = `${ROOT}/logs/paperclip`;

export interface PaperclipRun {
  runId: string;
  events: number;
  lastEvent?: string;
  lastEventAt?: string;
  status?: "running" | "completed" | "failed";
  taskName?: string;
  company?: string;
  mode?: string;
}

export interface PaperclipStatus {
  installed: boolean;
  configPresent: boolean;
  unitActive: "active" | "inactive" | "failed" | "unknown";
  recentRuns: PaperclipRun[];
  bridgeScript: string;
  contractEnv: string;
  notes: string[];
}

export async function paperclipStatus(): Promise<PaperclipStatus> {
  const installed = existsSync(`${APP}/package.json`) || existsSync(`${APP}/pyproject.toml`) || existsSync(`${APP}/bin`);
  const configPresent = existsSync(`${APP}/paperclip.env`);
  const r = await run("systemctl", ["--user", "is-active", "paperclip.service"], { timeoutMs: 1500 });
  const v = r.stdout.trim();
  const unitActive =
    v === "active" ? "active" : v === "failed" ? "failed" : v === "inactive" ? "inactive" : "unknown";

  const recentRuns = readRecentRuns();
  const notes: string[] = [];
  if (!installed) notes.push("Paperclip app not yet installed at /opt/agent-platform/apps/paperclip.");
  if (configPresent) notes.push("paperclip.env present (path refs only — never raw creds).");
  notes.push("Bridge ready: paperclip-company-runner translates env contract → leased codex worker.");

  return {
    installed,
    configPresent,
    unitActive,
    recentRuns,
    bridgeScript: `${ROOT}/runtime/bin/paperclip-company-runner`,
    contractEnv: `${ROOT}/apps/paperclip-platform-contract.env`,
    notes,
  };
}

function readRecentRuns(limit = 5): PaperclipRun[] {
  if (!existsSync(LOGDIR)) return [];
  const files = readdirSync(LOGDIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, t: statSync(`${LOGDIR}/${f}`).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
  return files.map(({ f, t }) => {
    const runId = f.replace(/\.jsonl$/, "");
    let events = 0;
    let lastEvent: string | undefined;
    let lastEventAt: string | undefined;
    let status: PaperclipRun["status"] | undefined;
    let taskName: string | undefined;
    let company: string | undefined;
    let mode: string | undefined;
    try {
      const text = readFileSync(`${LOGDIR}/${f}`, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        events++;
        try {
          const ev = JSON.parse(line) as Record<string, unknown>;
          lastEvent = (ev.type as string) ?? lastEvent;
          lastEventAt = (ev.ts as string) ?? lastEventAt;
          if (ev.type === "started") {
            taskName = (ev.task_name as string) ?? taskName;
            company = (ev.company as string) ?? company;
            mode = (ev.mode as string) ?? mode;
            status = "running";
          } else if (ev.type === "completed") {
            status = "completed";
          } else if (ev.type === "failed") {
            status = "failed";
          }
        } catch {
          // ignore malformed line
        }
      }
    } catch {
      // ignore
    }
    return {
      runId,
      events,
      lastEvent,
      lastEventAt: lastEventAt ?? new Date(t).toISOString(),
      status,
      taskName,
      company,
      mode,
    };
  });
}
