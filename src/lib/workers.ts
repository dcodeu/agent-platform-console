import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { ROOT } from "../config.ts";
import { run } from "./shell.ts";

export interface CodexRecentTask {
  ts: string;
  exit: number;
  cmd?: string;
}

export interface CodexWorker {
  id: string;
  enabled: boolean;
  authState: "valid" | "missing" | "quarantined" | "unknown";
  lastUsedAt?: number;
  usageToday: number;
  usageCount: number;
  recentTasks: CodexRecentTask[];
  notes?: string;
}

const WORKER_DIR = `${ROOT}/workers/codex`;
const WORKER_LOG_DIR = `${ROOT}/logs/codex-workers`;

function readRecentTasksFromUsage(usagePath: string, limit: number): { recent: CodexRecentTask[]; total: number } {
  const recent: CodexRecentTask[] = [];
  let total = 0;
  if (!existsSync(usagePath)) return { recent, total };
  try {
    const text = readFileSync(usagePath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    total = lines.length;
    // Take last `limit` lines, parse JSON-ish (the file uses single-quoted cmd → fix to safe JSON parse).
    const tail = lines.slice(-limit);
    for (const raw of tail) {
      try {
        // The on-disk file sometimes uses cmd:'' (Python repr); coerce to JSON.
        const safe = raw.replace(/'([^']*)'/g, (_m, inner: string) => JSON.stringify(inner));
        const obj = JSON.parse(safe) as { ts?: string; exit?: number; cmd?: string };
        if (obj && typeof obj.ts === "string") {
          recent.push({
            ts: obj.ts,
            exit: typeof obj.exit === "number" ? obj.exit : 0,
            cmd: typeof obj.cmd === "string" ? obj.cmd : undefined,
          });
        }
      } catch {
        // ignore single-line parse failures
      }
    }
    recent.reverse(); // newest first
  } catch {
    // ignore
  }
  return { recent, total };
}

function readRecentTasksFromLogs(id: string, limit: number): CodexRecentTask[] {
  // Fallback path: derive from filename timestamps in WORKER_LOG_DIR.
  if (!existsSync(WORKER_LOG_DIR)) return [];
  try {
    const files = readdirSync(WORKER_LOG_DIR)
      .filter((f) => f.startsWith(`${id}-`) && f.endsWith(".log"))
      .sort()
      .reverse()
      .slice(0, limit);
    return files.map((f) => {
      // codex-NN-YYYYMMDD-HHMMSS-PID.log
      const m = f.match(/^codex-\d+-(\d{8})-(\d{6})-\d+\.log$/);
      if (!m) return { ts: "", exit: 0 };
      const date = m[1];
      const time = m[2];
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
      return { ts: iso, exit: 0 };
    });
  } catch {
    return [];
  }
}

export async function codexPool(): Promise<CodexWorker[]> {
  if (!existsSync(WORKER_DIR)) return [];
  const out: CodexWorker[] = [];
  for (const entry of readdirSync(WORKER_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("codex-")) continue;
    const id = entry.name;
    const base = `${WORKER_DIR}/${id}`;
    const ymlPath = `${base}/worker.yml`;
    let enabled = false;
    let quarantined = false;
    if (existsSync(ymlPath)) {
      const yml = readFileSync(ymlPath, "utf8");
      enabled = /^\s*enabled\s*:\s*true/m.test(yml);
      quarantined = /^\s*quarantined\s*:\s*true/m.test(yml);
    }
    const authPath = `${base}/home/.codex/auth.json`;
    const hasAuth = existsSync(authPath);
    const lastUsedPath = `${base}/state/last-used.txt`;
    let lastUsedAt: number | undefined;
    if (existsSync(lastUsedPath)) {
      const t = Number(readFileSync(lastUsedPath, "utf8").trim());
      if (Number.isFinite(t)) {
        // The file stores unix seconds; the rest of the app expects ms.
        // Heuristic: anything before year 2200 in seconds (~7.25e9) gets *1000.
        lastUsedAt = t < 1e12 ? t * 1000 : t;
      }
    }
    const usagePath = `${base}/state/usage.jsonl`;
    let usageToday = 0;
    if (existsSync(usagePath)) {
      const today = new Date().toISOString().slice(0, 10);
      try {
        const text = readFileSync(usagePath, "utf8");
        for (const line of text.split("\n")) {
          if (line.includes(today)) usageToday++;
        }
      } catch {
        // ignore
      }
    }
    const { recent, total } = readRecentTasksFromUsage(usagePath, 5);
    const recentTasks = recent.length > 0 ? recent : readRecentTasksFromLogs(id, 5);
    out.push({
      id,
      enabled,
      authState: quarantined ? "quarantined" : hasAuth ? "valid" : "missing",
      lastUsedAt,
      usageToday,
      usageCount: total,
      recentTasks,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export interface IntegrationAudit {
  timestamp: string;
  service: string;
  action: string;
  actor: string;
  result: string;
  reason?: string;
}

export function recentIntegrationAudits(limit = 12): IntegrationAudit[] {
  const dir = `${ROOT}/logs/integrations`;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".log"))
    .map((f) => ({ f, t: statSync(`${dir}/${f}`).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit * 2);
  const out: IntegrationAudit[] = [];
  for (const { f } of files) {
    const m = f.match(/^(\d{8}T\d{6}Z)-([^-]+)-(.+?)\.log$/);
    if (!m) continue;
    let actor = "unknown";
    let result = "unknown";
    let reason: string | undefined;
    try {
      const content = readFileSync(`${dir}/${f}`, "utf8");
      const ka = content.match(/^actor:\s*(.+)$/m);
      if (ka) actor = ka[1].trim();
      const kr = content.match(/^result:\s*(.+)$/m);
      if (kr) result = kr[1].trim();
      const kre = content.match(/^reason:\s*(.+)$/m);
      if (kre) reason = kre[1].trim();
    } catch {
      // ignore
    }
    out.push({
      timestamp: m[1],
      service: m[2],
      action: m[3],
      actor,
      result,
      reason,
    });
    if (out.length >= limit) break;
  }
  return out;
}
