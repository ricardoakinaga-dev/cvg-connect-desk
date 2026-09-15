# ARCHITECTURE — CVG Connect Desk

Estado pós-modernização (fases 1–16, exceto itens marcados em `TRIPLE_AAA_CERTIFICATION.md`).

## Visão

```
WhatsApp → Evolution API → gateway_evochatwoot → CVG Connect Desk → Agent Secretary (IA)
                                                        ↓
                                                  React (desk-web)
```

## Runtimes

| Runtime | Papel | Entrada | Saída | Estado |
|---|---|---|---|---|
| `desk-api` (Fastify 5) | REST + webhooks + polling lease + `/metrics` | HTTP | PG, outbox | stateless (+ replay store em PG) |
| `message-worker` | consome outbox (`worker`), retry bounded, DLQ | PG outbox | alertas, outbox acks | stateless |
| `realtime-service` (`ws`) | broadcast por canais, auth por mensagem, heartbeat pong | PG outbox / `/events` | WebSocket | conexões em memória (documentado) |
| `desk-web` (React 18) | inbox, kanban, CRUD, backoff+jitter WS | API + WS | — | — |

## Contratos

- Fronteiras validadas: Fastify JSON-schema no HTTP; `InboundMessageV1` (zod) no pipeline gateway→chat (`@cvg/messaging-contracts`); HMAC `timestamp.rawBody` nos webhooks.
- Domínio nunca recebe payload cru da Evolution API (normalizer + contract test).

## Dados

PostgreSQL 15 + Drizzle. Outbox com fan-out por consumer (`worker`/`realtime`/`http-poll`), lease via `GET /events` + ACK explícito `POST /events/:id/ack`. Idempotência: `messages.external_message_id` (UNIQUE), `outbox_events.event_id` (UNIQUE), `outbound_deliveries.idempotency_key` (UNIQUE), `webhook_replay_log.event_id` (PK).

## Decisões (ADRs implícitos)

1. **Sem BullMQ**: fila = outbox Postgres (menos peças móveis; documentado como suficiente p/ escala atual).
2. **Sessões opacas com hash** em vez de JWT: revogação imediata, sem segredo de assinatura espalhado.
3. **Fail-secure > disponibilidade** em segurança (CORS, WEBHOOK_SECRET, bootstrap); **disponibilidade > IA** (Secretary é degraded, nunca fatal).
4. **Métricas in-process** em vez de OTEL SDK: zero deps novas; agregação no Prometheus.
