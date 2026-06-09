-- 001-approvals-table.sql
--
-- Unified approvals queue for the Agent Platform Console.
--
-- This is intentionally a DIFFERENT table from `gate_requests` (which lives in
-- the same database and powers Hermes's HMAC-signed /gate/* gate for
-- destructive-tool approvals from outside agents).
--
-- Why a second table:
--   - gate_requests is "approve / pattern / deny / escalate" with a 60s-15min
--     auto-expire and is keyed on agent_id+action — it's the security gate.
--   - approvals is the user-visible queue surfaced in the console UI: deploys,
--     merges, spend, custom workflow approvals from Paperclip, Hermes,
--     anywhere. Status is simpler (pending / approved / denied / expired /
--     cancelled), the source/kind taxonomy is open-ended, and timeouts can be
--     hours/days.
--
-- The two systems federate via the `payload` JSONB: an approvals row can
-- reference a gate_requests.id if the same approval is also gated at the
-- security layer.
--
-- Owner: ai_invocations (so the console process — running as grafana_reader —
-- can be GRANTed read+write on it without making grafana_reader an owner).
-- Grafana also gets SELECT for dashboard use.

CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,                  -- UUID v4 string or short slug
  source       TEXT NOT NULL,                     -- 'paperclip' | 'hermes' | 'agent:ceo' | 'manual' | 'gate' | etc.
  kind         TEXT NOT NULL,                     -- 'deploy' | 'merge' | 'destructive' | 'spend' | 'custom'
  title        TEXT NOT NULL,
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled'
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ,
  decided_via  TEXT,                              -- 'ui' | 'telegram' | 'imessage' | 'cli' | 'auto-expire'
  actor        TEXT,                              -- DJ's identifier for the channel that decided
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at   TIMESTAMPTZ,
  CONSTRAINT chk_approvals_status CHECK (status IN ('pending','approved','denied','expired','cancelled')),
  CONSTRAINT chk_approvals_decided_via CHECK (
    decided_via IS NULL OR decided_via IN ('ui','telegram','imessage','cli','auto-expire')
  )
);

CREATE INDEX IF NOT EXISTS idx_approvals_status_requested
  ON approvals (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_approvals_decided_at
  ON approvals (decided_at DESC) WHERE decided_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approvals_expires_pending
  ON approvals (expires_at) WHERE status = 'pending' AND expires_at IS NOT NULL;

-- Permissions: console runs as grafana_reader and needs full read+write here.
-- grafana also gets SELECT so dashboards can chart approvals.
GRANT SELECT, INSERT, UPDATE ON approvals TO grafana_reader;
GRANT SELECT ON approvals TO grafana;

-- A view of pending approvals ordered freshest-first — convenient for the
-- console + the iMessage NLP fallback ("approve" matches oldest pending for
-- the sender).
CREATE OR REPLACE VIEW approvals_pending AS
  SELECT *
    FROM approvals
   WHERE status = 'pending'
   ORDER BY requested_at DESC;

GRANT SELECT ON approvals_pending TO grafana_reader, grafana;
