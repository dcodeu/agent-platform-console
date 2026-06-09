import type { Context } from "hono";
import {
  GRAFANA_BASE,
  GRAFANA_SA_TOKEN,
  CF_ACCESS_CLIENT_ID,
  CF_ACCESS_CLIENT_SECRET,
} from "../config.ts";

export interface GrafanaProxyConfig {
  base: string;
  saToken: string;
  cfClientId: string;
  cfClientSecret: string;
}

// Read env once at module load. Empty strings = unconfigured; handlers short-circuit to 503.
const CONFIG: GrafanaProxyConfig = {
  base: GRAFANA_BASE.replace(/\/+$/, ""),
  saToken: GRAFANA_SA_TOKEN,
  cfClientId: CF_ACCESS_CLIENT_ID,
  cfClientSecret: CF_ACCESS_CLIENT_SECRET,
};

// CF Access tokens are optional: when GRAFANA_BASE points at loopback (the
// console runs on the same VPS as Grafana), the request never traverses CF
// Access, so the service-token headers can be omitted.
function configMissing(cfg: GrafanaProxyConfig): string | null {
  const missing: string[] = [];
  if (!cfg.base) missing.push("GRAFANA_BASE");
  if (!cfg.saToken) missing.push("GRAFANA_SA_TOKEN");
  // CF Access credentials must be either both set or both empty — half-set is a misconfig.
  const cfBothEmpty = !cfg.cfClientId && !cfg.cfClientSecret;
  const cfBothSet = !!cfg.cfClientId && !!cfg.cfClientSecret;
  if (!cfBothEmpty && !cfBothSet) {
    if (!cfg.cfClientId) missing.push("CF_ACCESS_CLIENT_ID");
    if (!cfg.cfClientSecret) missing.push("CF_ACCESS_CLIENT_SECRET");
  }
  return missing.length ? missing.join(",") : null;
}

let warnedMissing = false;
function warnOnceIfMissing(cfg: GrafanaProxyConfig): boolean {
  const missing = configMissing(cfg);
  if (missing && !warnedMissing) {
    console.warn(`[grafana-proxy] disabled, missing env: ${missing}`);
    warnedMissing = true;
  }
  return missing === null;
}

function upstreamHeaders(cfg: GrafanaProxyConfig): Headers {
  const h = new Headers();
  h.set("Authorization", `Bearer ${cfg.saToken}`);
  if (cfg.cfClientId && cfg.cfClientSecret) {
    h.set("CF-Access-Client-Id", cfg.cfClientId);
    h.set("CF-Access-Client-Secret", cfg.cfClientSecret);
  }
  h.set("Accept-Encoding", "identity");
  h.set("User-Agent", "agent-platform-console/grafana-proxy");
  return h;
}

const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

type ProxyMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH";

async function fetchUpstream(
  url: string,
  cfg: GrafanaProxyConfig,
  method: ProxyMethod,
  clientAccept?: string | null,
  body?: BodyInit | null,
  clientContentType?: string | null,
): Promise<Response> {
  const headers = upstreamHeaders(cfg);
  if (clientAccept) headers.set("Accept", clientAccept);
  if (clientContentType) headers.set("Content-Type", clientContentType);

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body ?? undefined,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      // Drain body to free socket.
      try { await res.arrayBuffer(); } catch { /* ignore */ }
      continue;
    }
    return res;
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
}

// Response headers to strip before forwarding to the browser.
const STRIP_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function buildClientHeaders(upstream: Response, isSoloPanel: boolean): Headers {
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    out.set(key, value);
  });
  out.set(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://agents.hawilson.xyz",
  );
  if (isSoloPanel) out.set("Cache-Control", "no-store");
  return out;
}

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"]);

export async function grafanaProxyHandler(c: Context): Promise<Response> {
  const method = c.req.method.toUpperCase() as ProxyMethod;
  if (!ALLOWED_METHODS.has(method)) {
    return c.json({ error: "method not allowed" }, 405);
  }
  if (!warnOnceIfMissing(CONFIG)) {
    return c.json({ error: "grafana proxy not configured" }, 503);
  }

  const url = new URL(c.req.url);
  // Two routing modes:
  //   /grafana/<path>      → strip /grafana, forward /<path>     (normal usage)
  //   /<grafana-asset>...  → forward unchanged                   (Grafana HTML emits
  //                                                              root-relative URLs
  //                                                              like /public/...)
  let upstreamPath: string;
  if (url.pathname.startsWith("/grafana/")) {
    upstreamPath = url.pathname.slice("/grafana".length); // keeps leading "/"
  } else if (url.pathname === "/grafana") {
    upstreamPath = "/";
  } else {
    upstreamPath = url.pathname;
  }
  const upstreamUrl = `${CONFIG.base}${upstreamPath}${url.search}`;
  const isSoloPanel = /^\/d-solo\//.test(upstreamPath);

  // Buffer the request body for non-idempotent methods so we can replay on redirect.
  let body: ArrayBuffer | null = null;
  if (method !== "GET" && method !== "HEAD") {
    try { body = await c.req.arrayBuffer(); } catch { body = null; }
  }

  try {
    const upstream = await fetchUpstream(
      upstreamUrl,
      CONFIG,
      method,
      c.req.header("accept"),
      body,
      c.req.header("content-type"),
    );

    if (upstream.status >= 500) {
      console.error(`[grafana-proxy] upstream ${upstream.status} for ${upstreamPath}`);
      return c.json(
        { error: "upstream error", status: upstream.status, upstream_url: upstreamUrl },
        502,
      );
    }

    const headers = buildClientHeaders(upstream, isSoloPanel);

    // Grafana renders root-relative URLs and reads its subpath from
    // window.grafanaBootData.settings.appSubUrl. Rewrite both so the panel
    // boots correctly while served from /grafana via this proxy.
    const upstreamCt = (upstream.headers.get("content-type") || "").toLowerCase();
    if (method === "GET" && upstreamCt.includes("text/html")) {
      const text = await upstream.text();
      // Hide Grafana 10 scenes top-bar that leaks into d-solo iframes — the
      // "Home" breadcrumb + dashboard picker is not useful inside our cockpit.
      const soloCssOverride = isSoloPanel
        ? `<style>
            [data-testid="data-testid Nav toolbar"],
            [data-testid*="dashboard-page-toolbar"],
            .scenes-dashboard-page-toolbar,
            [aria-label*="Skip to main content" i] { display: none !important; }
            section[data-testid="data-testid Dashboard panel content"],
            .react-grid-layout { padding-top: 0 !important; margin-top: 0 !important; }
            html, body, #reactRoot { background: transparent !important; }
          </style>`
        : "";
      const rewritten = text
        .replace(/<base href="\/" \/>/g, '<base href="/grafana/" />')
        .replace(/<base href="\/">/g, '<base href="/grafana/">')
        .replace(/"appSubUrl":""/g, '"appSubUrl":"/grafana"')
        // Grafana boots with `Intl.Locale(user.locale)`. Service accounts
        // default to "*", which V8 rejects ("Incorrect locale information
        // provided") and the frontend bails with the application-files
        // error. Force a valid BCP-47 tag in bootData.
        .replace(/"locale":"\*"/g, '"locale":"en-US"')
        .replace("</head>", `${soloCssOverride}</head>`);
      headers.delete("content-length");
      return new Response(rewritten, { status: upstream.status, headers });
    }

    const respBody = method === "HEAD" ? null : upstream.body;
    return new Response(respBody, {
      status: upstream.status,
      headers,
    });
  } catch (e) {
    const err = e as Error;
    console.error(`[grafana-proxy] fetch failed for ${upstreamPath}: ${err.message}`);
    return c.json(
      { error: err.message || "upstream fetch failed", status: 0, upstream_url: upstreamUrl },
      502,
    );
  }
}

export async function grafanaProxyHealthHandler(c: Context): Promise<Response> {
  if (!warnOnceIfMissing(CONFIG)) {
    return c.json({ error: "grafana proxy not configured" }, 503);
  }
  const url = `${CONFIG.base}/api/health`;
  try {
    const res = await fetchUpstream(url, CONFIG, "GET", "application/json");
    const text = await res.text();
    // Pass through upstream status and body verbatim; force JSON-safe content type if possible.
    const ct = res.headers.get("content-type") ?? "text/plain; charset=utf-8";
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": ct, "Cache-Control": "no-store" },
    });
  } catch (e) {
    const err = e as Error;
    console.error(`[grafana-proxy] health fetch failed: ${err.message}`);
    return c.json({ error: err.message || "fetch failed", status: 0 }, 502);
  }
}
