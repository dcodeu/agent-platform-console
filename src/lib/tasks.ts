import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { COMPANIES, LOGS } from "../config.ts";

export interface CompanyTask {
  company: string;
  project: string;
  taskName: string;
  repoName?: string;
  githubRepo?: string;
  workerProfile?: string;
  riskLevel?: string;
  mode?: string;
  status: "active" | "completed" | "archived";
  createdUtc?: string;
  metaPath: string;
  logPath?: string;
  logSizeBytes?: number;
}

export interface Company {
  slug: string;
  projects: string[];
  paperclipMapped: boolean;
}

const META_BASE = `${LOGS}/task-metadata`;

export function companies(): Company[] {
  if (!existsSync(COMPANIES)) return [];
  return readdirSync(COMPANIES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const slug = d.name;
      const projDir = `${COMPANIES}/${slug}/projects`;
      const projects = existsSync(projDir)
        ? readdirSync(projDir)
            .filter((f) => f.endsWith(".yml") && !f.startsWith("paperclip"))
            .map((f) => f.replace(/\.yml$/, ""))
        : [];
      return {
        slug,
        projects,
        paperclipMapped: existsSync(`${COMPANIES}/${slug}/paperclip.yml`),
      };
    });
}

export function activeTasks(): CompanyTask[] {
  return collectStatus("active").sort((a, b) => (b.createdUtc ?? "").localeCompare(a.createdUtc ?? ""));
}

export function recentTasks(limit = 8): CompanyTask[] {
  const all = [...collectStatus("active"), ...collectStatus("completed"), ...collectStatus("archived")];
  return all
    .sort((a, b) => (b.createdUtc ?? "").localeCompare(a.createdUtc ?? ""))
    .slice(0, limit);
}

function collectStatus(status: CompanyTask["status"]): CompanyTask[] {
  const dir = `${META_BASE}/${status}`;
  if (!existsSync(dir)) return [];
  const out: CompanyTask[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".env")) continue;
    const metaPath = `${dir}/${file}`;
    try {
      const meta = parseEnv(readFileSync(metaPath, "utf8"));
      const company = meta.COMPANY ?? "";
      const project = meta.PROJECT ?? "";
      const taskName = meta.TASK_NAME ?? file.replace(/\.env$/, "");
      out.push({
        company,
        project,
        taskName,
        repoName: meta.REPO_NAME,
        githubRepo: meta.GITHUB_REPO,
        workerProfile: meta.WORKER_PROFILE,
        riskLevel: meta.RISK_LEVEL,
        mode: meta.MODE,
        status: (meta.STATUS as CompanyTask["status"]) ?? status,
        createdUtc: meta.CREATED_UTC,
        metaPath,
        logPath: guessLogPath(company, project, taskName),
        logSizeBytes: undefined,
      });
    } catch {
      // skip malformed
    }
  }
  // size lookups deferred until rendering to avoid stat blast on every poll
  for (const t of out) {
    if (t.logPath && existsSync(t.logPath)) {
      try {
        t.logSizeBytes = statSync(t.logPath).size;
      } catch {
        // ignore
      }
    }
  }
  return out;
}

function guessLogPath(co: string, project: string, taskName: string): string | undefined {
  const candidates = [
    `${LOGS}/tasks/${co}-${project}-${taskName}.log`,
    `${LOGS}/tasks/${co}/${project}/${taskName}.log`,
    `${LOGS}/agent-runs/${co}-${project}-${taskName}.log`,
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return undefined;
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^export\s+/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    v = v.replace(/^['"]|['"]$/g, "");
    out[k] = v;
  }
  return out;
}
