# OBSERVABILITY — CVG Connect Desk

## Logs

- API: pino com `PINO_REDACT_PATHS` (authorization, cookies, `x-api-key`, `x-webhook-signature`, passwords, tokens, set-cookie).
- `redactObject()` (`@cvg/shared`): segredos → `[REDACTED]`, telefones → `[PHONE]:DD***UU`, circular-safe, sem mutação.
- Worker/realtime: JSON estruturado com `correlation_id`/`event_id`. Regra: nenhum `console.log` solto com PII (telefones mascarados).

## Métricas (`GET /metrics`, formato Prometheus)

`http_requests_total{method,route,status}`, `http_request_duration_seconds{method,route}`,
`webhook_requests_total{decision}`, `webhook_replay_rejected_total{reason}`, `messages_inbound_total`,
`messages_outbound_total{deduplicated}`, `auth_failures_total{reason}`, `authz_denials_total{reason}`,
`rate_limit_hits_total{route}`.

- Rota não registrada usa o label fixo `route="unmatched"` — a URL do cliente nunca vira label, então
  10k URLs distintas não criam 10k séries. PII de path/query/payload não entra na exposição.
- Labels são saneados (caracteres de controle removidos) e truncados em 120 chars; cada coletor limita
  a 1000 séries distintas e o excedente agrega em `__other__`.
- **Exposição:** `GET /metrics` exige `METRICS_TOKEN` (header `Authorization: Bearer <token>`) e/ou
  `METRICS_ALLOWED_CIDRS` (allowlist CSV de CIDRs IPv4/IPv6). Em produção, sem token e sem allowlist a
  resposta é **503 (fail-closed)**; fora de produção o default é aberto para coleta local. O token não é
  aceito por query string nem aparece em logs. No Compose de produção, o Prometheus envia o token via
  `authorization.credentials_file` (arquivo materializado em tmpfs, nunca versionado).

> **Atenção (hazard de resolução):** saídas `tsc` in-place em `packages/*/src/**/*.js` são ignoradas
> pelo `.gitignore`, mas o Vite resolve `.js` antes de `.ts`. Um artefato velho ao lado do fonte
> esconde a versão atual nas suítes — remova/limpe esses arquivos antes de rodar os gates.

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
