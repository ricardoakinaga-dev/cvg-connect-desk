# PROD-08 — Procedimento de recuperação / rollback

Candidato-base: `754f9bad` · Delta PROD-08 é **não rastreado** (sem baseline no git).
Nenhum schema/migration foi alterado; nenhuma mutação de dados foi executada fora dos bancos
isolados dos runs (removidos no teardown).

## 1. O que o delta muda

- `modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts`
  - advisory lock por `externalConversationId` no início da transação;
  - `DuplicateInboundRaceError` + rollback total da transação perdedora + releitura do vencedor;
  - `findOrphanConversations` (dry-run, read-only) e `reconcileOrphanConversations`
    (arquiva sob aprovação explícita; nunca apaga mensagens).
- `apps/desk-api/src/__tests__/production/prod-08.test.ts` (novo).
- `docs/producao-2026-09-13/evidencias/prod-08/**` (evidência).

Nada em `message.repository.ts`/`inbound-contact.repository.ts` foi modificado. Nada em
`packages/auth`, `webhook-guard`/`anti-replay`, `apps/realtime-service` ou migrations.

## 2. Rollback por arquivo (emergência)

1. Restaurar o snapshot funcional pré-delta:

   ```bash
   cp docs/producao-2026-09-13/evidencias/prod-08/rollback/inbound-atomic.repository.pre-prod08.ts \
      modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts
   ```

2. Remover a suíte nova (peculiar ao delta; importa `findOrphanConversations`/`reconcileOrphanConversations`):

   ```bash
   rm apps/desk-api/src/__tests__/production/prod-08.test.ts
   ```

3. Conferir que nenhum outro arquivo referencia as funções AC4 (devem sobrar apenas os
   backups/relatórios em evidência):

   ```bash
   grep -rn "findOrphanConversations\|reconcileOrphanConversations" --include='*.ts' modules apps packages
   ```

4. Revalidar: `pnpm --filter @cvg/chat typecheck && pnpm --filter @cvg/chat lint &&
   pnpm --filter @cvg/desk-api typecheck && pnpm --filter @cvg/desk-api lint`.

> **Aviso:** o pre-delta reintroduz o defeito BE08 (transação perdedora comita conversa/outbox
> órfãos). Use o rollback apenas se o delta causar regressão operacional; a correção preferível é
> roll-forward (ajuste incremental sobre o estado atual).

## 3. Dados

- **Não há migração/DDL a reverter.**
- A reconciliação AC4 **não foi executada contra nenhum banco existente**; a prova rodou no
  banco isolado (`cvg_aaa_prod08_w16`), removido no teardown (`dropDatabase: true`).
- Se um operador executar `reconcileOrphanConversations({approve:true})` em um banco real, o
  efeito é arquivamento (`is_active=false`, `status='archived'`, `status_v2='arquivado'`,
  `closed_at`) + 1 linha de histórico por conversa. Reversão manual possível (expand/contract
  invertido), sem perda de mensagens; o dry-run (`approve` ausente) é sempre seguro.
- Antes de qualquer execução real: `findOrphanConversations({ limit: 500 })` e revisão do
  relatório (`criterion`, `totalCandidates`, `truncated`, flags por candidato).

## 4. Regenerar as provas

```bash
# AC1–AC4 (19 testes, PostgreSQL isolado worker 16)
node scripts/production/run-integration-isolated.mjs --run-id prod08 --worker 16 -- \
  pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-08.test.ts

# repro/contraprova da corrida (worker 17)
node scripts/production/run-integration-isolated.mjs --run-id prod08-repro2 --worker 17 -- \
  pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-08/repro-antes.ts
```

Nunca reutilize `--run-id`/worker de outro executor; o runner provisiona PG/Redis com marcador
`cvg_aaa_*` e derruba ao final (`--keep` só para inspeção manual).
