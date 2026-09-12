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

## Tracing (OpenTelemetry — Final-2)

SDK oficial (`@cvg/tracing`): `initTracing()` por runtime (api/worker/realtime),
OTLP via `OTEL_EXPORTER_OTLP_ENDPOINT` (+ headers/attributes), noop quando
`OTEL_ENABLED != true`. Propagação W3C (`traceparent`/`tracestate`) no Secretary
(fetch) e gateway (axios) + continuação no webhook inbound.

Spans: `webhook.receive`, `secretary.invoke`, `gateway.send`, `worker.process`,
`realtime.publish` — com `correlation_id`/`event_id`/`message_id`/`conversation_id`
e sem segredos (`safeAttributes`). Outbox carrega correlation IDs (ponte entre
HTTP e worker). Testes: `packages/tracing/src/__tests__/tracing.test.ts` (7).

## Health

- `GET /health` (liveness), `GET /readiness` → `{ready, degraded, checks, version, timestamp}`.
- Secretary é `degraded`, nunca fatal. Redis via PING TCP real. Migrations checadas.

## Dashboards e alertas

Ver `SLO.md` (métricas por objetivo) e `RUNBOOK.md` (resposta a alertas).
