# DISASTER_RECOVERY — CVG Connect Desk

## RPO / RTO

| Ativo | RPO | RTO | Método |
|---|---|---|---|
| PostgreSQL | ≤ 24h (diário; apertar p/ 1h em produção crítica) | ≤ 2h | `pg-backup.sh` (custom+checksum+retenção) |
| Redis (rate-limit) | n/a (efêmero; reconstruído) | imediato | fail-secure: `skipOnError=false` nega sob falha |
| Object storage de mídia | **não implementado** (mídia em banco/URLs) | — | ver lacuna abaixo |
| Segredos (.env) | n/a | manual | rotação via variáveis de ambiente + redeploy |

## Restore

`infra/scripts/pg-restore.sh`: valida checksum, exige confirmação destrutiva,
`pg_restore --clean`, valida 5 tabelas críticas. **Restore ainda não testado
ponta-a-ponta** (sem pg client neste ambiente) → bloqueador parcial em
`TRIPLE_AAA_CERTIFICATION.md`.

## Rotação de segredos

`WEBHOOK_SECRET`/`JWT_SECRET`/API keys: trocar no provedor + variável + redeploy
rolling. Sessões: `POST /auth/logout-all` invalida tudo (rotação de emergência).

## Perda de Redis

Sem ação: rate-limit volta do zero; replay store usa PG (persistente).
