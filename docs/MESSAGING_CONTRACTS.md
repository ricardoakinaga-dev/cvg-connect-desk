# MESSAGING_CONTRACTS — CVG Connect Desk

Pacote `@cvg/messaging-contracts` (zod, versionados `specVersion: 1.0.0`).

## Contratos

| Contrato | Produtor | Consumidor |
|---|---|---|
| `InboundMessageV1` | normalizer gateway / webhook | `receiveInboundMessage` |
| `OutboundMessageV1` | `POST /messages` | provider (Evolution) |
| `CanonicalEventEnvelopeV1` | outbox publisher | worker / realtime / http-poll |

## Envelope de evento

```
specVersion, eventId, eventType, occurredAt, source, provider?,
instanceId?, aggregateType, aggregateId, correlationId?, causationId?,
traceId?, payload
```

## Regras

1. `externalMessageId` é obrigatório (sem fallback `Date.now`).
2. Webhook assina `timestamp.rawBody`; anti-replay por event ID.
3. Outbound exige `Idempotency-Key` (header) ou `clientMessageId` (body) para dedup; sem chave, cada request é nova.
4. `GET /events` = lease (120s); confirmação via `POST /events/:id/ack`. Response perdida ≠ evento perdido.
5. Domínio nunca importa payload cru da Evolution (contract tests em `modules/gateway-adapter/src/__tests__/gateway-contracts.test.ts`).

## Assinatura webhook

```
X-Webhook-Signature: sha256=HMAC(SECRET, timestamp + "." + rawBody)
X-Webhook-Timestamp: <epoch seconds>
X-Webhook-Event-Id: <opaco, único>
```
