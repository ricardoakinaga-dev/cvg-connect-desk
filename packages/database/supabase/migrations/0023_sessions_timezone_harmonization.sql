-- Migration: 0023_sessions_timezone_harmonization
-- Purpose: PROD-06 / DT01 — harmonizar os fusos das datas de sessão e fechar o
--   FK declarado de dead_letter_events.resolved_by.
--
-- Contexto do defeito (reproduzido em PG real):
--   sessions.last_seen_at/absolute_expires_at/revoked_at são TIMESTAMPTZ (0013),
--   mas sessions.expires_at/created_at nasceram como `timestamp` sem fuso (0003).
--   O driver grava `Date.toISOString()` (parede UTC) em coluna sem fuso, e a
--   leitura de `timestamp` sem fuso desloca o instante pelo offset do cliente
--   (ex.: America/Sao_Paulo soma/subtrai 3h em relação ao escrever). Resultado:
--   o deadline de expiração/rotação de sessão muda conforme o fuso do processo.
--
-- Expand/contract:
--   - Apenas conversão de tipo com preservação do instante; nenhuma coluna é
--     removida, nenhum dado é apagado, nenhum default destrutivo é aplicado.
--   - expires_at foi escrito pelo drizzle como parede UTC (`toISOString`), então
--     `AT TIME ZONE 'UTC'` reconstrói exatamente o instante original.
--   - created_at é preenchido pelo default `now()` do PostgreSQL, que grava a
--     parede local na TimeZone da sessão; `current_setting('TimeZone')` no
--     momento da migração reconstrói o instante original (o servidor mantém a
--     mesma TimeZone usada pelos writers).
--   - O FK de resolved_by entra como NOT VALID e é validado em seguida: novas
--     linhas passam a ser checadas imediatamente; a validação falha de forma
--     atômica (rollback da migration) se houver órfãos legados, exigindo
--     investigação antes do roll-forward.
--
-- Rollback (manual, fora desta migration): reverter tipo com
--   ALTER TABLE sessions ALTER COLUMN expires_at TYPE TIMESTAMP USING (expires_at AT TIME ZONE 'UTC');
--   ALTER TABLE sessions ALTER COLUMN created_at TYPE TIMESTAMP USING (created_at AT TIME ZONE 'UTC');
--   ALTER TABLE dead_letter_events DROP CONSTRAINT IF EXISTS dead_letter_events_resolved_by_fkey;
-- O rollback não perde dados, mas devolve o deadline sensível ao fuso do cliente.
-- Roll-forward preferível: manter a coluna TIMESTAMPTZ.

--> statement-breakpoint
ALTER TABLE sessions
  ALTER COLUMN expires_at TYPE TIMESTAMPTZ
    USING (expires_at AT TIME ZONE 'UTC'),
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING (created_at AT TIME ZONE current_setting('TimeZone'));

--> statement-breakpoint
ALTER TABLE dead_letter_events
  ADD CONSTRAINT dead_letter_events_resolved_by_fkey
    FOREIGN KEY (resolved_by) REFERENCES users(id) NOT VALID;

--> statement-breakpoint
ALTER TABLE dead_letter_events
  VALIDATE CONSTRAINT dead_letter_events_resolved_by_fkey;
