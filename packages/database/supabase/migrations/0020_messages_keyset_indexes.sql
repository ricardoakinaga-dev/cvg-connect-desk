-- Migration: 0020_messages_keyset_indexes
-- Purpose: AAA-11 / C06 + achado A10 — suporte à seleção da última mensagem
--          por conversa no banco (LATERAL + LIMIT 1), sem transferir o
--          histórico e sem N+1.
--
-- Expand-only: cria apenas índices. Nenhuma coluna/tabela alterada, nenhum
-- dado apagado, nenhum comportamento antigo invalidado (índices são
-- transparentes para leituras e escritas existentes).
--
--   idx_messages_conversation_created_id            (conversation_id, created_at DESC, id DESC)
--     -> última mensagem de cada conversa (qualquer direção)
--   idx_messages_conversation_direction_created_id  (conversation_id, direction, created_at DESC, id DESC)
--     -> última inbound de cada conversa
--
-- Rollback (manual): desnecessário para correção — índices não carregam
-- estado. Se preciso, remover fora de transação (produção):
--   DROP INDEX CONCURRENTLY IF EXISTS idx_messages_conversation_created_id;
--   DROP INDEX CONCURRENTLY IF EXISTS idx_messages_conversation_direction_created_id;
-- Roll-forward preferível: manter os índices; sem impacto funcional.
--
-- Nota: a migration roda em transação (drizzle) e é destinada a banco
-- isolado de teste/expansão. Em produção com tabela quente, aplicar os
-- CREATE INDEX CONCURRENTLY equivalentes fora de transação.

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id
  ON messages (conversation_id, created_at DESC, id DESC);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_conversation_direction_created_id
  ON messages (conversation_id, direction, created_at DESC, id DESC);
