-- 002-approvals-delivery-columns.sql
--
-- Promote Telegram delivery metadata + iMessage escalation timestamp out of
-- approvals.payload JSONB into first-class nullable columns. Existing payload
-- keys are backfilled, then left in place for backwards compatibility.

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS telegram_message_id INTEGER,
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

UPDATE approvals
   SET telegram_message_id = COALESCE(
         telegram_message_id,
         CASE
           WHEN payload ? 'telegram_message_id'
            AND (payload->>'telegram_message_id') ~ '^\d+$'
           THEN (payload->>'telegram_message_id')::INTEGER
           ELSE NULL
         END
       ),
       telegram_chat_id = COALESCE(
         telegram_chat_id,
         NULLIF(payload->>'telegram_chat_id', '')
       ),
       escalated_at = COALESCE(
         escalated_at,
         CASE
           WHEN payload ? 'escalated_at'
           THEN NULLIF(payload->>'escalated_at', '')::TIMESTAMPTZ
           ELSE NULL
         END
       )
 WHERE payload ?| ARRAY['telegram_message_id', 'telegram_chat_id', 'escalated_at'];

CREATE INDEX IF NOT EXISTS idx_approvals_escalated_pending
  ON approvals (requested_at ASC)
  WHERE status = 'pending' AND escalated_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON approvals TO grafana_reader;
GRANT SELECT ON approvals TO grafana;
