# AI_SAFETY — Agent Secretary

## Princípio

A IA nunca tem autoridade irrestrita. Toda invocação passa pelo gate
(`modules/secretary-adapter/src/application/ai-policy.ts`) **antes** de qualquer chamada externa.

## Classificação

| Classe | Ações | Efeito |
|---|---|---|
| `READ_ONLY` | `classify`, `evaluate` | só leitura/análise |
| `SAFE_WRITE` | `respond`, `handoff` | escrita reversível / escalonamento p/ humano (fail-safe) |
| `FORBIDDEN` | qualquer outra (deny-by-default) | negado com `AI_POLICY_DENIED` |

## Budgets (env, com defaults)

`SECRETARY_MAX_CONTENT_CHARS` (4000), `SECRETARY_MAX_HISTORY_ITEMS` (10),
`SECRETARY_MAX_INVOCATIONS_PER_CONVERSATION` (20), `SECRETARY_TIMEOUT_MS` (30000),
`SECRETARY_MAX_RETRIES` (2, só pré-resposta).

## Registro

`recordAIDecision()` (ring 500): invocationId, ação, classe, decisão, motivo,
conversation/message, sem prompt integral e sem PII (`sanitizeAIArgs`).
Negações publicam `secretary.invocation{failed, policyDenied}` (auditoria via outbox).

## Tool registry com enforcement (Final-10)

`ai-tools.ts`: READ_ONLY (`contact.lookup`, `conversation.read`), SAFE_WRITE
(`note.create`), SENSITIVE_WRITE (`contact.update`, `conversation.transfer`),
HUMAN_APPROVAL (`contact.delete`, `message.delete`, `sector.membership.change`),
FORBIDDEN (`permission.*`, `role.*`, `secret.*`, `audit.*`, `session.*`, `config.*`,
desconhecidas). `invokeAITool()` é o ponto único: HUMAN_APPROVAL sem aprovação
válida retorna `require_approval` (registro idempotente por args-hash, expira em
24h); `decideApproval()` registra reviewer/decisão; FORBIDDEN nega sempre.
As 4 ações legadas do fluxo (`classify/evaluate/respond/handoff`) mantêm classes
compatíveis (handoff→humano é direção fail-safe). Testes: `ai-tools.test.ts` (6).

## Degradação

Secretary fora/lento → atendimento humano continua (`readiness.degraded`, testes
`resilience.*`). IA nunca é dependência crítica.
