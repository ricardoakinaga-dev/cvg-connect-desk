# PROD-11 — Política de retenção da intenção outbound (C05/G03)

Implementada e testável em `outbound-delivery.repository.ts`; exercitada por
`prod-11.test.ts` (AC4) e pela contraprova `repro-antes.ts` (cenário C).
Nenhuma migration ou coluna nova: a política usa `expires_at`, o status da
delivery, o trigger de tombstone da migration 0021 e o índice
`idx_outbound_deliveries_reconciling`.

## Ciclo de vida

| Estado | O que é retido | Janela | O que acontece depois |
|---|---|---|---|
| `pending` / `accepted` / `unknown_reconciling` | delivery + mensagem + chave escopada; reconciliável por callback/confirmação | até `expires_at` (TTL de idempotência, `OUTBOUND_IDEMPOTENCY_TTL_MS`, padrão **24h**) | `expireStaleOutboundIntents({ apply: true })` terminaliza como `failed` + `last_error='idempotency_ttl_expired'` (mensagem `pending` → `failed`). A **linha permanece** como material do tombstone. O retry da mesma chave também terminaliza e responde `expired:true` (nunca reenvia). |
| `unknown_reconciling` (sem resolução) | delivery + mensagem | **indefinida** — não é purgável enquanto não resolver | É o estado que exige reconciliação: `listOutboundIntentsForReconciliation` lista, a rota `POST /gateway/outbound/:id/sent` ou `resolveOutboundIntentExplicitly` resolvem com evidência. Só depois de terminal entra na janela de purga. |
| `sent` / `failed` terminais | delivery + mensagem | `expires_at` + **30 dias** (`DEFAULT_OUTBOUND_INTENT_RETENTION_MS`) para a delivery | `purgeTerminalOutboundDeliveries({ apply: true })` remove SOMENTE a delivery; o trigger grava o tombstone (escopo+fingerprint+status, sem conteúdo) e a **mensagem nunca é apagada** (retenção de mensagens é política própria, D-B5). |
| Tombstones (`outbound_idempotency_tombstones`) | escopo + chave crua + fingerprint + status + `provider_message_id` | **permanente por padrão** | Preserva a proibição de reenvio (`key_archived` → 409). Apagar um tombstone reabilita a chave e só pode ocorrer por decisão explícita (documentado na migration 0021). |

## Garantias verificadas (AC4)

1. **Nada é apagado antes do TTL.** `listExpiredOutboundIntents` /
   `expireStaleOutboundIntents` só olham `expires_at <= now`; o dry-run não
   muta nada; o apply terminaliza sem DELETE.
2. **`unknown` antigo nunca é purgado.** `purgeTerminalOutboundDeliveries`
   filtra `status IN ('sent','failed')`; nenhuma quantidade de idade torna
   `unknown_reconciling` elegível.
3. **Purge não apaga estado de reconciliação.** Só deliveries terminais com
   `expires_at` anterior ao limite de 30 dias; `pending`/`accepted`/
   `unknown_reconciling` e linhas legadas com `expires_at NULL` ficam fora.
4. **Purge preserva a proibição de reenvio.** A remoção dispara
   `archive_outbound_delivery_tombstone`; o retry da chave purgada responde
   409 `IDEMPOTENCY_KEY_CONFLICT` (`key_archived`) sem chamar o provider.
5. **A mensagem sobrevive ao purge da delivery** (nenhum `DELETE FROM
   messages` nesta política).

## Operação (funções de biblioteca, sem rota nova)

```ts
// Inspeção (read-only) das intenções que exigem reconciliação:
await outboundDeliveryRepository.listOutboundIntentsForReconciliation({ olderThanMs: 0, limit: 100 });

// Dry-run e terminalização de vencidas (decisão explícita):
await outboundDeliveryRepository.listExpiredOutboundIntents({ limit: 100 });
await outboundDeliveryRepository.expireStaleOutboundIntents({ apply: false, limit: 100 }); // dry-run
await outboundDeliveryRepository.expireStaleOutboundIntents({ apply: true,  limit: 100 }); // aplica

// Dry-run e purge de terminais antigas (trigger grava tombstone):
await outboundDeliveryRepository.purgeTerminalOutboundDeliveries({ limit: 100 });            // dry-run
await outboundDeliveryRepository.purgeTerminalOutboundDeliveries({ apply: true, limit: 100 }); // aplica
```

`olderThan` do purge é parametrizável (`Date`); default = agora − 30 dias.
As funções são idempotentes sob concorrência (predicado de status + transação)
e nenhuma envia nada ao provider.

## Limites e dependências

- A retenção de **mensagens**, outbox/DLQ, auditoria, backups e mídia não é
  desta política (decisão D-B5, dono dados/jurídico); este documento cobre a
  intenção/delivery outbound.
- O tombstone não tem TTL implementado: remover tombstone é decisão explícita
  e reabilita a chave — não faz parte do purge.
- Deliveries legadas sem `expires_at` (anteriores à 0021 e não backfilled) não
  são elegíveis a purge nem a expiração automática; ficam preservadas.
