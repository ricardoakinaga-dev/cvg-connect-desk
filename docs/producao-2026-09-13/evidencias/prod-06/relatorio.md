# PROD-06 — Relatório de execução (candidato `754f9bad`, worktree preservado)

Data: 2026-09-13 · Run isolado: `prod06-20260913`, worker 8, PostgreSQL 16.15 em
`127.0.0.1:57232` (harness AAA) e Redis em `127.0.0.1:56760`. Nenhum comando
apontou para o banco do host (5432/5543). D03 permanece **OPEN**; N:N **não**
implementado.

## 1. Problema reproduzido

- `schema.ts` declarava as cinco datas de sessão como `timestamp` sem fuso. O DDL
  real: `last_seen_at/absolute_expires_at/revoked_at` são `TIMESTAMPTZ` (0013) e
  `expires_at/created_at` nasceram `TIMESTAMP` sem fuso (0003). O drizzle grava
  `toISOString()` (parede UTC); a leitura sem fuso interpreta a parede no fuso do
  cliente. Medição real em `REPRODUCAO.md` (item 5.3): o mesmo
  `'2026-06-01 12:00:00'::timestamp` lido em `America/Sao_Paulo` vira
  `2026-06-01T15:00:00Z` (deadline desloca +3h).
- Confronto completo (359 colunas declaradas × 359 reais): 5 enums declarados
  cujo DDL usa `TEXT` + `CHECK` e 2 colunas de `webhook_replay_log` declaradas sem
  fuso (arquivo fora do lock do PROD-06) — inventariados em
  `schema-confronto.json`, não corrigidos por escopo.
- FK declarada `dead_letter_events.resolved_by` ausente no DDL 0015 (gap real de
  integridade) — corrigida na 0023.
- `tutor_patients` N:N documentado em `docs/09-data-model.md` §6.4/§14.2 × 1:N
  `patients.tutor_id` implementado — inventário e proposta em `D03-PROPOSTA.md`.

## 2. Delta (arquivos e linhas)

| Arquivo | Mudança |
|---|---|
| `packages/database/src/schema.ts:279-287` | 5 datas de sessão com `{ withTimezone: true }` |
| `packages/database/src/schema.ts` (demais blocos) | declarações de timestamps alinhadas ao DDL real `TIMESTAMPTZ` (0 mudança de runtime: node-pg já entrega `Date`) |
| `packages/database/src/check-migrations.ts:24-63` | `REQUIRED_TABLES`/`REQUIRED_INDEXES` ampliados + `REQUIRED_TIMESTAMPTZ_COLUMNS` |
| `packages/database/src/check-migrations.ts:73,95,144-194` | código `SCHEMA_DRIFT` e `collectSchemaDrift()` (tabelas, índices, tipos de deadline) |
| `packages/database/src/check-migrations.ts:283-290` | drift bloqueia readiness após ledger ok |
| `packages/database/supabase/migrations/0023_sessions_timezone_harmonization.sql` | nova migration 0023 (SOMENTE): converte `sessions.expires_at`/`created_at` para `TIMESTAMPTZ` preservando instante + FK `dead_letter_events.resolved_by` (NOT VALID + VALIDATE) |
| `packages/database/supabase/migrations/meta/_journal.json:167-172` | entrada idx 23 da 0023 |
| `apps/desk-api/src/__tests__/production/prod-06.test.ts` (1430 linhas) | suíte real AC1–AC4 (POSTGRES isolado, sem mock) |
| `docs/producao-2026-09-13/evidencias/prod-06/**` | relatório, reprodução, D03-PROPOSTA, PROCEDIMENTO-RECUPERACAO, confronto JSON, logs |

Migrations 0000–0022 intocadas (confirmado por hash contra o baseline do PROD-00
no teste AC4.1).

## 3. Aceites com prova

Comando de prova (executado duas vezes, ambas verdes):

```bash
pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-06.test.ts
# exit 0 · 12 passed (12) · log: logs/vitest-prod-06.log
```

| Aceite | Prova no teste | Resultado |
|---|---|---|
| AC1 confronto + timezone | AC1.1 tipo de toda coluna timestamp × `information_schema`; AC1.2 FKs declaradas × `pg_constraint`; AC1.3 epoch idêntico em conexões `UTC` e `America/Sao_Paulo`, leitura drizzle + processo filho `TZ=America/Sao_Paulo` e deadlines `expired/absolute/idle`; AC1.4 rotação real via `authRepository` sem estender deadline absoluto | PASS |
| AC2 invariantes + caminhos | AC2.1 ledger 24/24 e hashes do journal; AC2.2 `23505`/`23503` negativos, cascade `messages→outbound_deliveries` com tombstone; AC2.3 upgrade populado em 0018 → 0019..0023 com dados e epochs preservados, backfill `legacy`; AC2.4 `SCHEMA_MISMATCH` (checksum), `SCHEMA_DRIFT` (índice e timestamptz), `SCHEMA_BEHIND`; AC2.5 `db:migrate` e `db:check` reais exit 0 | PASS |
| AC3 inventário/proposta | AC3.1 docs §6.4 presente, schema sem `tutor_patients`, 1:N real em `patients.tutor_id`, proposta com Impacto/Migração/Compatibilidade/Decisão OPEN; nenhum arquivo de módulo alterado | PASS |
| AC4 imutabilidade + roll-forward | AC4.1 hashes 0000–0022 == baseline PROD-00; AC4.2 0023 bloqueada por `ACCESS EXCLUSIVE`, filho morto com SIGKILL no meio da transação, ledger segue 23 e tipo inalterado, `ROLLBACK` + `migrate()` completa 24 com epoch preservado | PASS |

Comandos auxiliares reais (contra o PG isolado, log em `logs/`):

- `pnpm --filter @cvg/database run db:migrate` → `exit=0`
  (`Migrations completed successfully`).
- `pnpm --filter @cvg/database run db:check` → `exit=0`
  (`[migcheck] OK: 39 tabelas`).
- Filho TZ: `PROD06_CHILD {... "timezone":"America/Sao_Paulo", ...}` com todos os
  epochs iguais aos históricos (log `tz-child-america-sao-paulo.log`).
- Tipo de sessão no DDL pós-0023: as 5 colunas são `timestamp with time zone`
  (`schema-confronto.json`, seção `sessions`).

## 4. Regressões executadas

- `pnpm --filter @cvg/database test` → 27 passed, exit 0.
- `pnpm --filter @cvg/database exec tsc --noEmit` → exit 0.
- `pnpm --filter @cvg/desk-api exec tsc --noEmit` → exit 0.
- `eslint` dos arquivos alterados (`schema.ts`, `check-migrations.ts`,
  `prod-06.test.ts`) com `--max-warnings 0` → exit 0.
- `apps/desk-api/src/__tests__/aaa-09.integration.test.ts` não foi reexecutado
  (exige stack completa); o código novo só acrescenta `SCHEMA_DRIFT` e mantém os
  códigos/fields existentes — ver limitações.

## 5. Riscos e limitações

- **0023 em base quente:** `ALTER TABLE sessions ... TYPE TIMESTAMPTZ` faz rewrite
  e toma `ACCESS EXCLUSIVE`; a tabela de sessões é pequena. O
  `VALIDATE CONSTRAINT` falha de forma atômica se houver órfãos legados em
  `dead_letter_events.resolved_by` (procedimento em `PROCEDIMENTO-RECUPERACAO.md`).
- **Legado de `created_at`:** a conversão usa `current_setting('TimeZone')` do
  servidor no momento da migração; writers antigos gravavam `now()` na TZ da
  sessão. Se a TZ do servidor mudou desde a criação das linhas, o instante legado
  pode deslocar. Verificação sugerida no deploy: `SHOW timezone` + auditoria de
  amostra. `expires_at` é convertido por `AT TIME ZONE 'UTC'` (drizzle sempre
  gravou parede UTC).
- **Drift conhecido não corrigido:** 5 enums TEXT+CHECK e `webhook-replay.ts`
  (fora do lock). Está registrado em `schema-confronto.json`; não bloqueia
  readiness porque o drift é por coluna declarada enum vs TEXT (não é checado
  como invariante física obrigatória).
- **`REQUIRED_TIMESTAMPTZ_COLUMNS`** inclui colunas de outros módulos; qualquer
  rollback futuro que devolva essas colunas para `timestamp` passa a bloquear
  readiness com `SCHEMA_DRIFT` (comportamento desejado).
- Teste roda contra binários locais do harness; não substitui o pipeline de CI.

## 6. Recuperação

Ver `PROCEDIMENTO-RECUPERACAO.md`: interrupção da 0023 é segura (transação única;
nada é commitado), recuperação = liberar lock/terminar backend pendurado e repetir
`db:migrate` (roll-forward); rollback manual só com decisão explícita e perde a
proteção de fuso. Teardown do harness remove somente os bancos `cvg_aaa_prod06_*`
do run e as instâncias PG/Redis do worker 8.

## 7. O que NÃO foi comprovado

- **N:N `tutor_patients` não implementado por decisão D03 OPEN** (proposta em
  `D03-PROPOSTA.md`; implementação/ratificação pertencem a PROD-25).
- Conversão de `audit_logs`, `messages.sent_at`, `tasks.due_at`, `outbox_events`
  e demais timestamps sem fuso para `TIMESTAMPTZ` **não** foi feita (fora do
  escopo do AC1, que trata das datas de sessão).
- `aaa-09` (readiness HTTP) e a suíte integrada completa não foram reexecutadas
  nesta sessão; o probe foi exercitado direto por `checkDatabaseReadiness`.
- Não há validação em dados de produção (não existem) nem autorização de deploy;
  o integrador deve validar e decidir o fechamento.
