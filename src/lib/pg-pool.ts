// Shared pg connection pool for native Postgres queries against the
// ai_invocations_db (tokens + imessage tables) under the `grafana_reader`
// role. The collectors in heavy.ts and the /api/metrics/pg endpoint share it.

import pg from "pg";
import { AI_INVOCATIONS_DB_URL } from "../config.ts";

const { Pool } = pg;
export type { Pool as PgPool } from "pg";

let aiInvocationsPool: pg.Pool | null = null;

export function getAiInvocationsPool(): pg.Pool | null {
  if (!AI_INVOCATIONS_DB_URL) return null;
  if (aiInvocationsPool) return aiInvocationsPool;
  aiInvocationsPool = new Pool({
    connectionString: AI_INVOCATIONS_DB_URL,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    application_name: "agent-platform-console",
  });
  aiInvocationsPool.on("error", (e) => {
    console.error("[pg-pool ai_invocations]", e.message);
  });
  return aiInvocationsPool;
}
