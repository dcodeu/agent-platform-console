-- 003-approval-decision-comment.sql
--
-- Add durable decision metadata for approval results. All fields are nullable so
-- legacy approve/deny callers and historical rows continue to work.

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS decision_comment TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE approvals
   SET updated_at = COALESCE(updated_at, requested_at),
       closed_at = COALESCE(closed_at, decided_at)
 WHERE updated_at IS NULL
    OR (closed_at IS NULL AND decided_at IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_idempotency_key
  ON approvals (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS approval_events (
  seq BIGSERIAL PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_snapshot JSONB NOT NULL,
  CONSTRAINT chk_approval_events_event_type CHECK (event_type IN ('created','updated','closed')),
  CONSTRAINT uq_approval_events_once UNIQUE (approval_id, event_type, status)
);

CREATE INDEX IF NOT EXISTS idx_approval_events_seq
  ON approval_events (seq ASC);

GRANT SELECT, INSERT, UPDATE ON approvals TO grafana_reader;
GRANT SELECT ON approvals TO grafana;
GRANT SELECT, INSERT ON approval_events TO grafana_reader;
GRANT SELECT ON approval_events TO grafana;
GRANT USAGE, SELECT ON SEQUENCE approval_events_seq_seq TO grafana_reader;
