import { spawn } from "node:child_process";
import { stream } from "hono/streaming";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile, readdir, stat } from "node:fs/promises";
import { statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { HOST, PORT, ROOT } from "./config.ts";
import { getSnapshot } from "./lib/snapshot.ts";
import { hostinger } from "./lib/hostinger.ts";
import { getHeavySnapshot } from "./lib/heavy.ts";
import { run as shellRun } from "./lib/shell.ts";
import { broadcast, streamSseHandler, subscriberCount } from "./lib/sse.ts";
import { grafanaProxyHandler, grafanaProxyHealthHandler } from "./lib/grafana-proxy.ts";
import {
  prometheusHandler,
  lokiHandler,
  postgresHandler,
} from "./lib/metrics-proxy.ts";
import {
  createApproval,
  decideApproval,
  getApproval,
  listApprovals,
  startApprovalSweeper,
  classifyImessageIntent,
  resolveImessageTarget,
  sendImessage,
  isTelegramUserAllowed,
  type ApprovalStatus,
} from "./lib/approvals.ts";

// Build id = short hash of css+js+sw contents at server start. Changes on every redeploy.
// Includes BOTH the legacy bundles (still served for /docs/* etc.) AND the
// v2 React island bundle entry points so a v2-only rebuild invalidates the
// id and busts browser/CF caches on next refresh.
function computeBuildId(): string {
  const h = createHash("sha1");
  for (const p of [
    "public/assets/app.css",
    "public/assets/app.js",
    "public/sw.js",
    "public/v2/main.js",
    "public/v2/main.css",
    "public/v2/wall.js",
    "public/v2/wall.css",
  ]) {
    try { h.update(readFileSync(p)); } catch { /* ignore */ }
  }
  return h.digest("hex").slice(0, 10);
}
export const BUILD_ID = computeBuildId();
console.log(`[console] build id: ${BUILD_ID}`);

const app = new Hono();

const DOCS_DIR = `${ROOT}/apps/proxy/conf.d/docs`;
const TASK_LOGS = `${ROOT}/logs/tasks`;
const INTEGRATION_LOGS = `${ROOT}/logs/integrations`;
const LEGACY_ASSETS = `${ROOT}/apps/proxy/conf.d/_assets`;

app.use("/assets/*", serveStatic({ root: "./public" }));
app.use("/_assets/*", serveStatic({ root: LEGACY_ASSETS, rewriteRequestPath: (p) => p.replace(/^\/_assets/, "") }));

// Console shell — Vite-built React island mounted at #v2-root. Served at both
// `/` (canonical) and `/v2` (alias for back-compat bookmarks). The static
// bundle lives under public/v2/ and is served at /v2-static/*.
function renderConsoleShell(): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>Agent Platform</title>
  <meta name="theme-color" content="#0a0e16" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" />
  <link rel="stylesheet" href="/v2-static/tokens.css?v=${BUILD_ID}" />
  <link rel="stylesheet" href="/v2-static/main.css?v=${BUILD_ID}" />
</head>
<body>
  <div id="v2-root"></div>
  <script type="module" src="/v2-static/main.js?v=${BUILD_ID}"></script>
</body>
</html>`;
}
// /v2-static/* — serve the Vite-built React island bundles.
// Two cache tiers: the entry files (main.js, main.css, wall.js, wall.css,
// tokens.css) keep their fixed names so we revalidate every load. The
// content-hashed chunks under chunks/ are immutable, cache them long.
app.use("/v2-static/*", async (c, next) => {
  await next();
  const p = c.req.path;
  if (p.includes("/chunks/")) {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    c.header("Cache-Control", "no-cache, must-revalidate");
  }
});
app.use("/v2-static/*", serveStatic({ root: "./public/v2", rewriteRequestPath: (p) => p.replace(/^\/v2-static/, "") }));

// /v2 — legacy alias kept alive so old bookmarks keep working. Serves the
// same shell as /.
app.get("/v2", (c) => {
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return c.html(renderConsoleShell());
});

// /wall — NOC big-board surface (TV-mounted, read-only, fixed Overview).
// Loads the second Vite entry (public/v2/wall.{js,css}). Auth/CF Access
// policy is the same as /v2 — both live under agents.hawilson.xyz.
app.get("/wall", (c) => {
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return c.html(`<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>Agent Platform · /wall</title>
  <meta name="theme-color" content="#0a0e16" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" />
  <link rel="stylesheet" href="/v2-static/tokens.css?v=${BUILD_ID}" />
  <link rel="stylesheet" href="/v2-static/wall.css?v=${BUILD_ID}" />
</head>
<body>
  <div id="wall-root"></div>
  <script type="module" src="/v2-static/wall.js?v=${BUILD_ID}"></script>
</body>
</html>`);
});

const PWA_FILES: Record<string, { path: string; type: string; cache?: string }> = {
  "/manifest.webmanifest": { path: "public/manifest.webmanifest", type: "application/manifest+json", cache: "public, max-age=300" },
  "/sw.js":                { path: "public/sw.js",                type: "application/javascript", cache: "no-cache" },
  "/offline.html":         { path: "public/offline.html",         type: "text/html; charset=utf-8", cache: "no-cache" },
  "/icon.svg":             { path: "public/icon.svg",             type: "image/svg+xml", cache: "public, max-age=604800" },
  "/icon-maskable.svg":    { path: "public/icon-maskable.svg",    type: "image/svg+xml", cache: "public, max-age=604800" },
  "/icon-192.png":         { path: "public/icon-192.png",         type: "image/png", cache: "public, max-age=604800" },
  "/icon-512.png":         { path: "public/icon-512.png",         type: "image/png", cache: "public, max-age=604800" },
  "/icon-maskable-192.png":{ path: "public/icon-maskable-192.png",type: "image/png", cache: "public, max-age=604800" },
  "/icon-maskable-512.png":{ path: "public/icon-maskable-512.png",type: "image/png", cache: "public, max-age=604800" },
  "/apple-touch-icon.png": { path: "public/apple-touch-icon.png", type: "image/png", cache: "public, max-age=604800" },
  "/favicon-32.png":       { path: "public/favicon-32.png",       type: "image/png", cache: "public, max-age=604800" },
};

for (const [route, meta] of Object.entries(PWA_FILES)) {
  app.get(route, async (c) => {
    try {
      const data = await readFile(meta.path);
      c.header("Content-Type", meta.type);
      if (meta.cache) c.header("Cache-Control", meta.cache);
      if (route === "/sw.js") c.header("Service-Worker-Allowed", "/");
      return c.body(data);
    } catch {
      return c.text("not found", 404);
    }
  });
}

app.get("/favicon.ico", async (c) => {
  try {
    const data = await readFile("public/favicon-32.png");
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "public, max-age=604800");
    return c.body(data);
  } catch {
    return c.body(null, 204);
  }
});

app.get("/docs", (c) => c.redirect("/docs/"));
app.get("/docs/", async (c) => {
  try {
    const files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".html")).sort();
    const links = files
      .map((f) => {
        const name = f.replace(/\.html$/, "");
        return `<li><a href="/docs/${name}">${name}</a></li>`;
      })
      .join("");
    return c.html(`<!doctype html><meta charset="utf-8"><title>Docs · Agent Platform</title>
<link rel="stylesheet" href="/assets/app.css">
<main class="console"><h1 style="font-family:var(--font-display);">Documentation</h1>
<ul style="line-height:2.2;font-family:var(--font-mono);">${links}</ul>
<p><a href="/">← back to console</a></p></main>`);
  } catch {
    return c.text("docs unavailable", 404);
  }
});

const LEGACY_DOC_REDIRECTS: Record<string, string> = {
  "/platform-readme": "/docs/readme",
  "/platform-commands": "/docs/commands",
  "/paperclip-contract": "/docs/paperclip-contract",
  "/hermes-contract": "/docs/hermes-contract",
  "/task-brief-template": "/docs/task-brief",
  "/integration-policy": "/docs/integration-policy",
  "/hermes-signalops-daily-health": "/docs/hermes-daily",
};
for (const [from, to] of Object.entries(LEGACY_DOC_REDIRECTS)) {
  app.get(from, (c) => c.redirect(to));
}

app.get("/docs/:name", async (c) => {
  const name = c.req.param("name").replace(/\.html$/, "");
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return c.text("invalid name", 400);
  try {
    const content = await readFile(`${DOCS_DIR}/${name}.html`, "utf8");
    return c.html(content);
  } catch {
    return c.text("doc not found", 404);
  }
});

function safeJoin(base: string, rel: string): string | null {
  const full = `${base}/${rel}`.replace(/\/+/g, "/");
  if (!full.startsWith(base + "/")) return null;
  if (rel.includes("..")) return null;
  return full;
}

async function serveLogIndex(c: import("hono").Context, dir: string, prefix: string, title: string) {
  try {
    const files = (await readdir(dir)).sort().reverse().slice(0, 200);
    const rows = files
      .map((f) => `<tr><td><a href="${prefix}${f}">${f}</a></td></tr>`)
      .join("");
    return c.html(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/assets/app.css">
<main class="console"><h1 style="font-family:var(--font-display);">${title}</h1>
<p class="mono dim">Showing ${files.length} most recent</p>
<table style="font-family:var(--font-mono);font-size:12.5px;"><tbody>${rows}</tbody></table>
<p><a href="/">← back to console</a></p></main>`);
  } catch {
    return c.text("logs directory unavailable", 404);
  }
}

app.get("/logs", (c) => c.redirect("/logs/"));
app.get("/logs/", (c) => serveLogIndex(c, TASK_LOGS, "/logs/", "Task logs"));
app.get("/logs/:file", async (c) => {
  const f = c.req.param("file");
  if (!/^[a-zA-Z0-9._-]+$/.test(f)) return c.text("invalid", 400);
  const full = safeJoin(TASK_LOGS, f);
  if (!full) return c.text("invalid path", 400);
  try {
    const s = await stat(full);
    if (!s.isFile()) return c.text("not a file", 404);
    const text = await readFile(full, "utf8");
    return c.text(text, 200, { "Content-Type": "text/plain; charset=utf-8" });
  } catch {
    return c.text("log not found", 404);
  }
});

app.get("/integration-logs", (c) => c.redirect("/integration-logs/"));
app.get("/integration-logs/", (c) => serveLogIndex(c, INTEGRATION_LOGS, "/integration-logs/", "Integration audit log"));
app.get("/integration-logs/:file", async (c) => {
  const f = c.req.param("file");
  if (!/^[a-zA-Z0-9._-]+$/.test(f)) return c.text("invalid", 400);
  const full = safeJoin(INTEGRATION_LOGS, f);
  if (!full) return c.text("invalid path", 400);
  try {
    const text = await readFile(full, "utf8");
    return c.text(text, 200, { "Content-Type": "text/plain; charset=utf-8" });
  } catch {
    return c.text("log not found", 404);
  }
});

app.get("/", (c) => {
  // Force browsers / Cloudflare to always re-fetch the shell, never serve a cached page.
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return c.html(renderConsoleShell());
});

app.get("/api/build", (c) => c.json({ build: BUILD_ID, time: new Date().toISOString() }));

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "1.0.0", time: new Date().toISOString() }),
);

app.get("/api/snapshot.json", async (c) => {
  const snap = await getSnapshot();
  return c.json(snap);
});

app.get("/api/vitals", async (c) => {
  const snap = await getSnapshot();
  return c.json({
    generatedAt: snap.generatedAt,
    local: snap.local,
    localHistory: snap.localHistory,
    hostinger: {
      configured: snap.hostinger.configured,
      cpuPct: snap.hostinger.metrics?.cpuPct.last ?? null,
      ramBytes: snap.hostinger.metrics?.ramBytes.last ?? null,
      diskBytes: snap.hostinger.metrics?.diskBytes.last ?? null,
      netInBytes: snap.hostinger.metrics?.netInBytes.last ?? null,
      netOutBytes: snap.hostinger.metrics?.netOutBytes.last ?? null,
      uptimeSeconds: snap.hostinger.metrics?.uptimeSeconds.last ?? null,
      cpuSeries: snap.hostinger.metrics?.cpuPct.points.map((p) => p.v) ?? [],
      ramSeries: snap.hostinger.metrics?.ramBytes.points.map((p) => p.v) ?? [],
      diskSeries: snap.hostinger.metrics?.diskBytes.points.map((p) => p.v) ?? [],
      netInSeries: snap.hostinger.metrics?.netInBytes.points.map((p) => p.v) ?? [],
      netOutSeries: snap.hostinger.metrics?.netOutBytes.points.map((p) => p.v) ?? [],
    },
  });
});

app.get("/api/agents", async (c) => {
  const snap = await getSnapshot();
  return c.json(snap.agents);
});

app.get("/api/tasks", async (c) => {
  const snap = await getSnapshot();
  return c.json(snap.tasks);
});

app.get("/api/hostinger/ping", async (c) => c.json(await hostinger.ping()));

app.get("/api/audit", async (c) => {
  const snap = await getSnapshot();
  return c.json(snap.audits);
});

app.get("/api/ops/heavy.json", async (c) => {
  const heavy = await getHeavySnapshot();
  c.header("Cache-Control", "no-cache");
  return c.json(heavy);
});

app.get("/api/alerts", async (c) => {
  const heavy = await getHeavySnapshot();
  return c.json({ alerts: heavy.alerts, generatedAt: heavy.generatedAt });
});

app.get("/api/companies", async (c) => {
  const heavy = await getHeavySnapshot();
  return c.json({ companies: heavy.companies, activeCompanyId: heavy.activeCompanyId });
});

app.get("/api/stream", (c) => streamSseHandler(c));

app.get("/api/stream/stats", (c) => c.json({ subscribers: subscriberCount() }));

app.get("/api/logs/:container", (c) => {
  const container = c.req.param("container");
  if (!/^[a-zA-Z0-9_.-]+$/.test(container)) return c.text("invalid container", 400);

  return stream(c, async (out) => {
    const proc = spawn("docker", ["logs", "--tail", "100", "-f", container]);
    proc.stdout.on("data", (data) => void out.write(data));
    proc.stderr.on("data", (data) => void out.write(data));
    c.req.raw.signal.addEventListener("abort", () => proc.kill(), { once: true });
    await new Promise<void>((resolve) => {
      proc.once("close", () => resolve());
      c.req.raw.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  });
});

let lastAlertIds = new Set<string>();
let lastResourceAlertIds = new Set<string>();
let lastHeartbeatStates = new Map<string, string>();
setInterval(async () => {
  try {
    const heavy = await getHeavySnapshot(true);
    const currentIds = new Set(heavy.alerts.map((a) => a.id));
    for (const a of heavy.alerts) {
      if (!lastAlertIds.has(a.id)) broadcast("alert.created", a);
    }
    for (const oldId of lastAlertIds) {
      if (!currentIds.has(oldId)) broadcast("alert.resolved", { id: oldId });
    }
    lastAlertIds = currentIds;

    for (const hb of heavy.heartbeats) {
      const key = `${hb.id}:${hb.lastHeartbeatAt}`;
      if (lastHeartbeatStates.get(hb.id) !== key) {
        lastHeartbeatStates.set(hb.id, key);
        broadcast("heartbeat", {
          agentId: hb.id,
          agentName: hb.agentName,
          status: hb.status,
          lastHeartbeatAt: hb.lastHeartbeatAt,
        });
      }
    }

    broadcast("cost.tick", {
      mtdDollars: heavy.costs.mtd.dollars,
      todayDollars: heavy.costs.today.dollars,
      budgetPct: heavy.costs.budgetPct,
    });
  } catch (e) {
    console.error("[sse-heavy-poll]", (e as Error).message);
  }
}, 60_000);

setInterval(async () => {
  try {
    const snap = await getSnapshot();
    const resourceAlerts = buildResourceAlerts(snap);
    const currentIds = new Set(resourceAlerts.map((a) => a.id));
    for (const a of resourceAlerts) {
      if (!lastResourceAlertIds.has(a.id)) broadcast("alert.created", a);
    }
    for (const oldId of lastResourceAlertIds) {
      if (!currentIds.has(oldId)) broadcast("alert.resolved", { id: oldId });
    }
    lastResourceAlertIds = currentIds;
  } catch (e) {
    console.error("[sse-light-poll]", (e as Error).message);
  }
}, 10_000);

function buildResourceAlerts(snap: Awaited<ReturnType<typeof getSnapshot>>) {
  const memPct = (snap.local.memUsedBytes / Math.max(1, snap.local.memTotalBytes)) * 100;
  const diskPct = (snap.local.diskRootUsedBytes / Math.max(1, snap.local.diskRootTotalBytes)) * 100;
  const resources = [
    { id: "resource:cpu", label: "CPU", pct: snap.local.cpuPct, warn: 80, crit: 95 },
    { id: "resource:mem", label: "Memory", pct: memPct, warn: 85, crit: 95 },
    { id: "resource:disk", label: "Root disk", pct: diskPct, warn: 85, crit: 95 },
  ];

  return resources
    .filter((r) => r.pct >= r.warn)
    .map((r) => ({
      id: r.id,
      severity: r.pct >= r.crit ? "critical" : "warn",
      kind: "local_resource",
      title: `${r.label} at ${Math.round(r.pct)}%`,
      detail: `${snap.local.hostname} · sampled from light snapshot`,
      sinceMs: snap.generatedAt,
    }));
}

// Native metrics proxies — power the v2 React island's direct-query panels
// (replacing several Grafana iframes). See lib/metrics-proxy.ts for
// validation rules. The Postgres endpoint is read-only and SELECT-only.
app.get("/api/metrics/prom", prometheusHandler);
app.get("/api/metrics/loki", lokiHandler);
app.post("/api/metrics/pg", postgresHandler);

// ────────────────────────────────────────────────────────────
// Approvals API
//
// Unified queue ingested from multiple channels: UI button clicks here,
// Telegram inline-button callbacks (via /api/approvals/webhook/telegram),
// iMessage NLP ("approve" / "deny" text replies via /api/approvals/webhook/imessage),
// and direct CLI POSTs from agents (Paperclip, Hermes, etc.).
//
// SSE events `approval.created` and `approval.decided` fire on every change
// so the UI updates without polling.
// ────────────────────────────────────────────────────────────

interface CreateApprovalBody {
  source?: string;
  kind?: string;
  title?: string;
  detail?: string;
  payload?: Record<string, unknown>;
  expiresAt?: string;
  id?: string;
  silent?: boolean;
}

app.post("/api/approvals", async (c) => {
  let body: CreateApprovalBody;
  try {
    body = (await c.req.json()) as CreateApprovalBody;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "body must be a JSON object" }, 400);
  }
  if (!body.source || !body.kind || !body.title) {
    return c.json({ error: "source, kind, and title are required" }, 400);
  }
  try {
    const { id } = await createApproval({
      source: String(body.source),
      kind: String(body.kind),
      title: String(body.title),
      detail: body.detail ? String(body.detail) : undefined,
      payload: body.payload && typeof body.payload === "object" ? body.payload : {},
      expiresAt: body.expiresAt ?? null,
      id: body.id,
      silent: !!body.silent,
    });
    return c.json({ id, ok: true }, 201);
  } catch (e) {
    console.error("[api] POST /api/approvals failed", e);
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.get("/api/approvals", async (c) => {
  const statusParam = c.req.query("status");
  const status =
    statusParam == null
      ? undefined
      : (statusParam as ApprovalStatus | "all");
  const limit = Number(c.req.query("limit") ?? "50");
  const source = c.req.query("source") ?? undefined;
  const before = c.req.query("before") ?? undefined;
  const after = c.req.query("after") ?? undefined;
  try {
    const rows = await listApprovals({
      status,
      limit: Number.isFinite(limit) ? limit : 50,
      source,
      before,
      after,
    });
    return c.json({ approvals: rows, count: rows.length });
  } catch (e) {
    console.error("[api] GET /api/approvals failed", e);
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.get("/api/approvals/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const row = await getApproval(id);
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

interface DecideBody {
  action?: "approve" | "deny" | "cancel";
  via?: "ui" | "telegram" | "imessage" | "cli";
  actor?: string;
  comment?: unknown;
}

app.post("/api/approvals/:id/decide", async (c) => {
  const id = c.req.param("id");
  let body: DecideBody;
  try {
    body = (await c.req.json()) as DecideBody;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  if (!body.action || !["approve", "deny", "cancel"].includes(body.action)) {
    return c.json({ error: "action must be approve|deny|cancel" }, 400);
  }
  const via = body.via ?? "ui";
  try {
    const result = await decideApproval({
      id,
      action: body.action,
      via,
      actor: body.actor,
      comment: body.comment,
    });
    if (!result.ok) {
      const status = result.reason === "comment must be a string" ? 400 : 409;
      return c.json({ error: result.reason ?? "unable to decide" }, status);
    }
    return c.json({ ok: true, status: result.status, row: result.row });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

/**
 * Legacy / banner-compat shim:
 *   POST /api/approvals/:id  body { action: 'approve' | 'reject' }
 *
 * The existing ApprovalBanner.tsx posts here. Translate "reject" → "deny" and
 * forward to the same decideApproval path with via=ui.
 */
app.post("/api/approvals/:id", async (c) => {
  const id = c.req.param("id");
  let body: { action?: "approve" | "reject" | "deny" | "cancel" };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const raw = body.action;
  if (!raw) return c.json({ error: "action is required" }, 400);
  const action =
    raw === "reject" ? "deny" : (raw as "approve" | "deny" | "cancel");
  try {
    const result = await decideApproval({ id, action, via: "ui" });
    if (!result.ok) {
      return c.json({ error: result.reason ?? "unable to decide" }, 409);
    }
    return c.json({ ok: true, status: result.status });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

/**
 * Telegram webhook — called by the long-poll listener
 * (approvals-telegram-listener.py) on every callback_query whose data starts
 * with `approval:`. We don't expose this to the open internet; the listener
 * runs on the same host and POSTs to 127.0.0.1.
 */
interface TelegramCallbackBody {
  callback_data?: string;
  from_user_id?: string | number;
  from_name?: string;
}

app.post("/api/approvals/webhook/telegram", async (c) => {
  let body: TelegramCallbackBody;
  try {
    body = (await c.req.json()) as TelegramCallbackBody;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const data = body.callback_data ?? "";
  if (!data.startsWith("approval:")) {
    return c.json({ error: "callback_data is not an approval action" }, 400);
  }
  const userId = body.from_user_id;
  if (userId == null || !isTelegramUserAllowed(userId)) {
    return c.json({ error: "unauthorized telegram user" }, 403);
  }
  const parts = data.split(":");
  if (parts.length !== 3) {
    return c.json({ error: "malformed callback_data" }, 400);
  }
  const [, id, actionToken] = parts;
  const action =
    actionToken === "approve"
      ? "approve"
      : actionToken === "deny"
        ? "deny"
        : null;
  if (!action) return c.json({ error: "unknown action token" }, 400);
  try {
    const result = await decideApproval({
      id,
      action,
      via: "telegram",
      actor: `tg:${userId}${body.from_name ? ` (${body.from_name})` : ""}`,
    });
    if (!result.ok) return c.json({ error: result.reason ?? "fail" }, 409);
    return c.json({ ok: true, status: result.status });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

/**
 * SendBlue inbound iMessage webhook.
 *   body: { from: "+1...", text: "approve" }
 *
 * NLP-classifies the text and decides the OLDEST pending approval (or one
 * matched by short-id prefix in the text). Sends a confirmation iMessage on
 * success.
 */
interface ImessageBody {
  from?: string;
  text?: string;
}

app.post("/api/approvals/webhook/imessage", async (c) => {
  let body: ImessageBody;
  try {
    body = (await c.req.json()) as ImessageBody;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const text = (body.text ?? "").trim();
  if (!text) return c.json({ error: "text is required" }, 400);
  const intent = classifyImessageIntent(text);
  if (!intent) {
    return c.json({ ok: false, reason: "no approve/deny intent in text" });
  }
  const target = await resolveImessageTarget(text);
  if (!target) {
    sendImessage("No pending approvals — nothing to act on.");
    return c.json({ ok: false, reason: "no pending approvals" });
  }
  const action = intent === "approve" ? "approve" : "deny";
  const result = await decideApproval({
    id: target.id,
    action,
    via: "imessage",
    actor: body.from ? `imessage:${body.from}` : "imessage",
  });
  if (!result.ok) {
    sendImessage(`Could not ${action} approval — ${result.reason ?? "error"}.`);
    return c.json({ ok: false, reason: result.reason ?? "fail" }, 409);
  }
  const verb = action === "approve" ? "Approved" : "Denied";
  const short = target.id.slice(0, 8);
  sendImessage(`${verb}: ${target.title.slice(0, 100)} (id ${short}).`);
  return c.json({ ok: true, status: result.status, id: target.id });
});

// ────────────────────────────────────────────────────────────
// Codex pool actions
//
// Same-origin POST gate. Worker ID validated against ^codex-\d{2}$. Shells
// out to the runtime helpers — never accepts user-supplied args.
// ────────────────────────────────────────────────────────────

const CODEX_ID_RE = /^codex-\d{2}$/;
const CODEX_QUAR_BIN = `${ROOT}/runtime/bin/codex-worker-quarantine`;
const CODEX_UNQUAR_BIN = `${ROOT}/runtime/bin/codex-worker-unquarantine`;

function isSameOriginPost(c: import("hono").Context): boolean {
  const origin = c.req.header("Origin");
  if (!origin) {
    // Curl from localhost / same host (no Origin header) — accept only when
    // the Host header itself is set (it always is in HTTP/1.1). This keeps
    // CSRF-from-browser blocked while letting server-to-server calls through.
    return true;
  }
  const host = c.req.header("Host");
  if (!host) return false;
  try {
    const u = new URL(origin);
    return u.host === host;
  } catch {
    return false;
  }
}

async function runCodexAction(
  c: import("hono").Context,
  bin: string,
  label: string,
): Promise<Response> {
  if (!isSameOriginPost(c)) {
    return c.json({ error: "cross-origin requests not allowed" }, 403);
  }
  const idParam = c.req.param("id");
  if (!idParam || !CODEX_ID_RE.test(idParam)) {
    return c.json({ error: "invalid worker id" }, 400);
  }
  const id: string = idParam;
  try {
    const r = await shellRun(bin, [id], { timeoutMs: 10_000 });
    return c.json({
      ok: r.code === 0,
      action: label,
      id,
      exitCode: r.code,
      stdout: r.stdout.slice(-400),
      stderr: r.stderr.slice(-400),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message, action: label, id }, 500);
  }
}

app.post("/api/codex/:id/quarantine", (c) =>
  runCodexAction(c, CODEX_QUAR_BIN, "quarantine"),
);
app.post("/api/codex/:id/unquarantine", (c) =>
  runCodexAction(c, CODEX_UNQUAR_BIN, "unquarantine"),
);

app.all("/grafana/*", grafanaProxyHandler);
app.get("/grafana-proxy/health", grafanaProxyHealthHandler);
// Grafana HTML emits root-relative URLs for its own static assets and websocket
// channels — forward those to the same upstream so iframes load correctly.
app.all("/public/*", grafanaProxyHandler);
app.all("/avatar/*", grafanaProxyHandler);
app.all("/api/live/*", grafanaProxyHandler);
app.all("/api/datasources/proxy/*", grafanaProxyHandler);
app.all("/api/ds/query", grafanaProxyHandler);
app.all("/api/frontend-metrics", grafanaProxyHandler);

app.get("/healthz", (c) => c.text("ok"));

const server = serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
});

console.log(`[console] listening on http://${HOST}:${PORT}`);

// Start the approvals sweeper: marks pending rows as expired when expires_at
// passes, and sends an URGENT iMessage if a row has been pending >10min
// without escalation yet. See lib/approvals.ts:sweepApprovals.
try {
  startApprovalSweeper();
} catch (e) {
  console.error("[console] failed to start approval sweeper", e);
}

function shutdown(sig: string) {
  console.log(`[console] received ${sig}, shutting down`);
  try {
    // Node's serve returns a Node http.Server-like object.
    (server as unknown as { close?: () => void }).close?.();
  } catch (e) {
    console.error("[console] close error", e);
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
