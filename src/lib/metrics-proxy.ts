// Native query proxies for Prometheus, Loki, and Postgres.
//
// These power the v2 React island's "native chart" panels — replacing the
// Grafana iframe path for the panels that we render directly in the
// Console. The Grafana proxy in grafana-proxy.ts remains the path for full
// Grafana dashboards we still embed.
//
// Contract:
//   - All responses are JSON.
//   - Errors return { error: string, status: number } with a non-2xx HTTP code.
//   - 5s upstream timeout. No retry (the island re-polls on its own cadence).
//   - Cache-Control: no-cache on all responses.

import type { Context } from "hono";
import { PROMETHEUS_URL, LOKI_URL } from "../config.ts";
import { getAiInvocationsPool } from "./pg-pool.ts";

const UPSTREAM_TIMEOUT_MS = 5_000;

interface JsonError {
  error: string;
  status: number;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function setNoCache(c: Context): void {
  c.header("Cache-Control", "no-cache");
}

// --- Prometheus ------------------------------------------------------------

export async function prometheusHandler(c: Context): Promise<Response> {
  setNoCache(c);
  const q = c.req.query("q");
  if (!q) {
    return c.json<JsonError>({ error: "missing q (PromQL expression)", status: 400 }, 400);
  }
  const start = c.req.query("start");
  const end = c.req.query("end");
  const step = c.req.query("step");
  const isRange = !!(start && end && step);

  const params = new URLSearchParams();
  params.set("query", q);
  if (isRange) {
    params.set("start", String(start));
    params.set("end", String(end));
    params.set("step", String(step));
  }
  const path = isRange ? "/api/v1/query_range" : "/api/v1/query";
  const url = `${PROMETHEUS_URL}${path}?${params.toString()}`;

  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) {
      return c.json<JsonError>(
        { error: `prometheus upstream ${res.status}: ${text.slice(0, 200)}`, status: 502 },
        502,
      );
    }
    // Forward verbatim. Prometheus already returns valid JSON.
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    return c.json<JsonError>(
      { error: `prometheus fetch failed: ${(e as Error).message}`, status: 503 },
      503,
    );
  }
}

// --- Loki -----------------------------------------------------------------

export async function lokiHandler(c: Context): Promise<Response> {
  setNoCache(c);
  const q = c.req.query("q");
  if (!q) {
    return c.json<JsonError>({ error: "missing q (LogQL expression)", status: 400 }, 400);
  }
  const start = c.req.query("start");
  const end = c.req.query("end");
  const limitStr = c.req.query("limit") ?? "100";
  const direction = c.req.query("direction") ?? "backward";
  const limit = Math.max(1, Math.min(5000, Number(limitStr) || 100));

  const params = new URLSearchParams();
  params.set("query", q);
  params.set("limit", String(limit));
  params.set("direction", direction);
  if (start) params.set("start", String(start));
  if (end) params.set("end", String(end));

  // Use query_range when start+end provided, else fall back to instant.
  const path = start && end ? "/loki/api/v1/query_range" : "/loki/api/v1/query";
  const url = `${LOKI_URL}${path}?${params.toString()}`;

  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) {
      return c.json<JsonError>(
        { error: `loki upstream ${res.status}: ${text.slice(0, 200)}`, status: 502 },
        502,
      );
    }
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    return c.json<JsonError>(
      { error: `loki fetch failed: ${(e as Error).message}`, status: 503 },
      503,
    );
  }
}

// --- Postgres (read-only, ai_invocations DB) ------------------------------

interface PgQueryBody {
  sql?: unknown;
  params?: unknown;
}

const SELECT_RE = /^select\b/i;

export async function postgresHandler(c: Context): Promise<Response> {
  setNoCache(c);
  let body: PgQueryBody;
  try {
    body = (await c.req.json()) as PgQueryBody;
  } catch {
    return c.json<JsonError>({ error: "body must be JSON", status: 400 }, 400);
  }
  if (typeof body.sql !== "string" || body.sql.trim().length === 0) {
    return c.json<JsonError>({ error: "sql must be a non-empty string", status: 400 }, 400);
  }
  const sql = body.sql.trim();
  if (!SELECT_RE.test(sql)) {
    return c.json<JsonError>(
      { error: "only SELECT queries are allowed", status: 400 },
      400,
    );
  }
  // Reject semicolons inside the query to block multi-statement injections.
  // (pg's parameterized path still binds params separately, but this is a
  // defense-in-depth check — concatenated DELETE/UPDATE attempts via
  // user-supplied SQL would have to slip a `;` past us first.)
  const sqlBody = sql.replace(/;\s*$/, "");
  if (sqlBody.includes(";")) {
    return c.json<JsonError>(
      { error: "multi-statement queries are not allowed", status: 400 },
      400,
    );
  }
  const params = Array.isArray(body.params) ? (body.params as unknown[]) : [];

  const pool = getAiInvocationsPool();
  if (!pool) {
    return c.json<JsonError>(
      { error: "AI_INVOCATIONS_DB_URL not configured", status: 503 },
      503,
    );
  }
  try {
    const res = await pool.query({
      text: sqlBody,
      values: params,
    });
    const columns = res.fields.map((f) => f.name);
    const rows = res.rows.map((row) => columns.map((col) => (row as Record<string, unknown>)[col]));
    return c.json({ columns, rows });
  } catch (e) {
    const msg = (e as Error).message;
    return c.json<JsonError>({ error: `pg query failed: ${msg}`, status: 400 }, 400);
  }
}
