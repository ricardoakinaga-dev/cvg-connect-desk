# PROD-06 — Reprodução do defeito de timezone de sessão (DT01)

Data: 2026-09-13 · Ambiente: PostgreSQL 16 isolado do harness AAA
(`cvg_aaa_prod06_20260913_w8`, 127.0.0.1:57232) — nunca o banco do host.

## Defeito

`schema.ts` declarava as datas de sessão como `timestamp` sem fuso. O DDL real
tem `sessions.last_seen_at/absolute_expires_at/revoked_at` como `TIMESTAMPTZ`
(migration 0013), mas `sessions.expires_at`/`created_at` nasceram como
`TIMESTAMP` sem fuso (migration 0003). O drizzle grava `Date.toISOString()`
(parede UTC) e a leitura de `timestamp` sem fuso interpreta a parede no fuso do
cliente — o instante/deadline muda com o fuso do processo.

## Medição antes da correção (banco em 0022, colunas sem fuso)

```bash
pnpm exec tsx <script isolado>
# SELECT '2026-06-01 12:00:00'::timestamp, '2026-06-01 12:00:00+00'::timestamptz
```

Resultado real por TZ do cliente:

| Cliente TZ | `timestamp` sem fuso | `timestamptz` |
|---|---|---|
| `UTC` | `2026-06-01T12:00:00.000Z` | `2026-06-01T12:00:00.000Z` |
| `America/Sao_Paulo` | `2026-06-01T15:00:00.000Z` | `2026-06-01T12:00:00.000Z` |

O mesmo valor lido em `America/Sao_Paulo` desloca o deadline em +3h; um deadline
de expiração/rotação gravado para 12:00Z passa a valer 15:00Z naquele cliente
(ou o inverso ao escrever), quebrando C01 (“7d normal, 30d absoluto, 24h idle”,
rotação sem estender deadline) de forma dependente de ambiente.

## Correção e contraprova

- `schema.ts`: as cinco datas de sessão passaram a `{ withTimezone: true }`;
- migration `0023_sessions_timezone_harmonization.sql`: converte
  `sessions.expires_at` (parede UTC → `AT TIME ZONE 'UTC'`) e
  `sessions.created_at` (`now()` local → `current_setting('TimeZone')`) para
  `TIMESTAMPTZ`, preservando o instante; adiciona o FK declarado
  `dead_letter_events.resolved_by` (NOT VALID + VALIDATE).
- Contraprova executada por `apps/desk-api/src/__tests__/production/prod-06.test.ts`
  (AC1.3/AC1.4): sessão com valores históricos de 2020 é lida com o mesmo epoch
  em conexões `UTC` e `America/Sao_Paulo`, por SQL (`extract(epoch ...)`) e por
  um processo filho real com `TZ=America/Sao_Paulo` usando o `schema.ts` do
  candidato via drizzle; deadlines (expiração exata, absoluto, idle) são
  avaliados por `evaluateSession` e a rotação real pelo repositório preserva o
  deadline absoluto.
