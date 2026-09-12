-- Conversation inbox state: inbound activity must remain visible to humans.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS unread_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversations_unread
  ON conversations(unread_count);

-- Existing human handoffs must not disappear after the rollout.
UPDATE conversations
SET unread_count = 1
WHERE current_handler = 'human'
  AND unread_count = 0
  AND is_active = TRUE;

-- Reconstitui a atividade e as entradas ainda não respondidas por humano.
-- Respostas automáticas da Secretary não apagam a pendência humana.
WITH conversation_activity AS (
  SELECT
    c.id,
    MAX(m.created_at) AS last_activity_at,
    COUNT(*) FILTER (
      WHERE m.direction = 'inbound'
        AND m.created_at > COALESCE((
          SELECT MAX(h.created_at)
          FROM messages h
          WHERE h.conversation_id = c.id
            AND h.direction = 'outbound'
            AND h.sender_type = 'human'
        ), '-infinity'::timestamp)
    )::integer AS pending_inbound_count
  FROM conversations c
  LEFT JOIN messages m ON m.conversation_id = c.id
  WHERE c.is_active = TRUE
  GROUP BY c.id
)
UPDATE conversations c
SET
  updated_at = GREATEST(c.updated_at, a.last_activity_at),
  unread_count = GREATEST(c.unread_count, a.pending_inbound_count)
FROM conversation_activity a
WHERE c.id = a.id
  AND a.last_activity_at IS NOT NULL;
