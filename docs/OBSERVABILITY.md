# OBSERVABILITY — CVG Connect Desk

## Logs

- API: pino com `PINO_REDACT_PATHS` (authorization, cookies, `x-api-key`, `x-webhook-signature`, passwords, tokens, set-cookie).
- `redactObject()` (`@cvg/shared`): segredos → `[REDACTED]`, telefones → `[PHONE]:DD***UU`, circular-safe, sem mutação.
- Worker/realtime: JSON estruturado com `correlation_id`/`event_id`. Regra: nenhum `console.log` solto com PII (telefones mascarados).

## Métricas (`GET /metrics`, formato Prometheus)

`http_requests_total`, `http_request_duration_seconds`, `webhook_requests_total{decision}`,
`webhook_replay_rejected_total{reason}`, `messages_inbound_total`, `messages_outbound_total{deduplicated}`,
`auth_failures_total{reason}`, `authz_denials_total{reason}`, `rate_limit_hits_total`.
Protegido por `METRICS_TOKEN` quando configurado (aviso em prod aberta).

## Tracing

Propagação de `correlationId`/`causationId`/`eventId` no outbox + `conversationId`/`messageId` nos logs.
**Lacuna honesta**: sem OpenTelemetry SDK (decisão: zero deps; ver `TRIPLE_AAA_CERTIFICATION.md`).

## Health

- `GET /health` (liveness), `GET /readiness` → `{ready, degraded, checks, version, timestamp}`.
- Secretary é `degraded`, nunca fatal. Redis via PING TCP real. Migrations checadas.

## Dashboards e alertas

Ver `SLO.md` (métricas por objetivo) e `RUNBOOK.md` (resposta a alertas).
