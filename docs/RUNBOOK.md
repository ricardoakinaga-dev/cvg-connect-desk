# RUNBOOK — CVG Connect Desk

## Webhook 5xx em produção

1. Checar `GET /admin/webhook-security/stats` (motivos) + `webhook_requests_total`.
2. `missing_secret` → setar `WEBHOOK_SECRET` e redeploy.
3. `invalid_signature` em massa → conferir rotação de segredo no gateway / skew de relógio (>300s).
4. `duplicate_event_id` alto → gateway reenviando; o ACK é 2xx idempotente,
   mas investigar a causa no gateway e correlacionar `event_id`.

## Fila parada (worker)

1. `GET /readiness` (database ok?). 2. Logs do worker (`correlation_id`). 3. `GET /dead-letter` (persistente) e `GET /admin/dead-letters/stats` (legado em memória).
4. Replay persistente: `POST /dead-letter/:id/replay` (409 em duplicata) ou `POST /dead-letter/replay-batch`; descarte consciente: `POST /dead-letter/:id/discard`. Tudo auditado.

## Login em massa 401

`auth_failures_total{reason}`: `invalid_credentials` = ataque/força bruta (rate limit 10/min segura);
`inactive` = offboarding pendente. Revogar tudo: `POST /auth/logout-all`.

## Realtime caindo

Cliente faz backoff + heartbeat; `pong` ausente no servidor? Checar `realtime-service` (porta 8080, `DESK_API_URL`).
Stale (>60s sem mensagem) reconecta sozinho.

## Banco cheio / lento

`pgdata` em volume; slow queries: `messages(conversation_id)`, `outbox_events(processed)`.
Restore: `infra/scripts/pg-restore.sh` (ver `DISASTER_RECOVERY.md`).

## Rollback

Deploys via compose: `docker compose up -d --build <svc>`. Migrations são forward-only e backward-compatible
(colunas NULLABLE); rollback de código não exige downgrade de banco nas migrations 0013/0014.
