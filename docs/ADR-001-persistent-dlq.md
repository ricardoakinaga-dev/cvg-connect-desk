# ADR-001 — Persistent DLQ (PostgreSQL)

- Status: accepted. Data: 2026.
- Contexto: DLQ em memória perdia eventos em restart/escala; replay manual sem idempotência.
- Decisão: tabela `dead_letter_events` (UNIQUE evento+consumer, CHECK de status), claim atômico PENDING→REPLAYING, replay com novo event_id + causation, API `/dead-letter/*` com RBAC+audit. Worker com dual-write (memória p/ compat + PG durável).
- Alternativas: Redis Streams (perde sem persistência AOF garantida no setup atual); tabela genérica de jobs (overkill).
- Consequências: restart-safe (testado); +1 escrita por falha terminal (fora do hot path).
- Segurança: rotas admin:write, tudo auditado; payload jsonb validado no replay (422 em corrompido).
- Operacional: `countByStatus`/`oldestPendingAge` para alertas; batch replay para drenar.
