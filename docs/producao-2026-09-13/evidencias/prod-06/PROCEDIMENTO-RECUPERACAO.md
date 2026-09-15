# PROD-06 — Procedimento de recuperação da migration 0023

Migration: `packages/database/supabase/migrations/0023_sessions_timezone_harmonization.sql`
(journal `meta/_journal.json`, idx 23, when 1789315204000). SQLs 0000–0022 não são
editáveis (imutáveis); o roll-forward é sempre preferido.

## Propriedades

- O migrator do drizzle executa todas as migrations pendentes em **uma transação**
  (`drizzle-orm/pg-core/dialect.js`, `migrate()`): interrupção/crash antes do
  `COMMIT` reverte tudo — nenhum estado parcial de tipo e nenhuma linha no ledger.
- A 0023 é expand-only: converte `sessions.expires_at`/`created_at` para
  `TIMESTAMPTZ` preservando o instante, e adiciona o FK
  `dead_letter_events_resolved_by_fkey` (`NOT VALID` + `VALIDATE`). Nenhum
  `DROP`/`DELETE` e nenhum default destrutivo.
- O FK valida de forma atômica: se existirem órfãos legados em
  `dead_letter_events.resolved_by`, a migration falha e faz rollback; investigar
  os órfãos antes de reaplicar (não apagar dados para “passar”).

## Ensaio real executado (AC4.2)

Banco `cvg_aaa_prod06_20260913_w8_interrupt` parado no ledger 0022 (23 linhas) com
uma sessão legada. O teste `prod-06.test.ts` AC4.2:

1. abre transação e trava `sessions` em `ACCESS EXCLUSIVE`;
2. dispara `pnpm --filter @cvg/database run db:migrate` com
   `DATABASE_URL=.../cvg_aaa_prod06_20260913_w8_interrupt?application_name=prod06-interrupt`;
3. espera `pg_stat_activity` mostrar o processo bloqueado (`wait_event_type='Lock'`);
4. envia `SIGKILL` ao grupo do processo (crash simulado, sem `COMMIT`);
5. prova: ledger continua com 23 linhas e `sessions.expires_at` continua
   `timestamp without time zone` (rollback íntegro);
6. libera o lock (`ROLLBACK`) e roda o `migrate()` de novo (restart/roll-forward);
7. prova: ledger com 24 linhas, hashes conferem com o journal, colunas em
   `timestamp with time zone` e o epoch da sessão legada preservado.

Log: `logs/interrupt-roll-forward.log`. Resultado: PASS no comando de prova.

## Procedimento de recuperação (operador)

Se um deploy for interrompido durante a 0023 (processo morto, timeout, rollout
cancelado):

1. **Não editar** o SQL da 0023 nem qualquer SQL 0000–0022.
2. Confirmar que nada ficou pela metade (o ledger não deve conter a 0023):
   ```sql
   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;
   SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sessions' AND column_name IN ('expires_at','created_at');
   ```
   Esperado antes da 0023: 23 linhas e `timestamp without time zone`.
3. Se houver conexão pendurada bloqueando `sessions`:
   `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='<db>' AND wait_event_type='Lock';`
   (a transação do migrator é revertida; nada é commitado).
4. Roll-forward: repetir `pnpm --filter @cvg/database run db:migrate` com o mesmo
   `DATABASE_URL`.
5. Validar: `pnpm --filter @cvg/database run db:check` (fresh + invariantes) e o
   probe de readiness (`checkDatabaseReadiness` → `migrations.status='ok'`).
6. Para produção com `dead_letter_events` grande, o `VALIDATE CONSTRAINT` ocorre
   na mesma transação; se houver órfãos legados, a migration falha de forma
   atômica — resolver os órfãos (backfill/`resolved_by = NULL` conforme política
   de dados, com autorização) e reaplicar. Nunca usar `DELETE` de dados para
   destravar teste.

## Rollback (manual, somente se a decisão for reverter o fuso)

```sql
ALTER TABLE sessions ALTER COLUMN expires_at TYPE TIMESTAMP USING (expires_at AT TIME ZONE 'UTC');
ALTER TABLE sessions ALTER COLUMN created_at TYPE TIMESTAMP USING (created_at AT TIME ZONE 'UTC');
ALTER TABLE dead_letter_events DROP CONSTRAINT IF EXISTS dead_letter_events_resolved_by_fkey;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<sha256 da 0023>';
```

O rollback não perde dados, mas devolve o deadline sensível ao fuso do cliente —
por isso o roll-forward é o caminho recomendado. A remoção da linha do ledger só
pode ocorrer com a migration revertida no DDL; caso contrário o readiness acusa
`SCHEMA_DRIFT`.
