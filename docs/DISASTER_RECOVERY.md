# DISASTER_RECOVERY — CVG Connect Desk

## RPO / RTO (formais)

| Ativo | RPO | RTO | Método |
|---|---|---|---|
| PostgreSQL | ≤ 24h (diário; apertar p/ 1h em produção crítica) | ≤ 2h | `pg-backup.sh` (custom+checksum+retenção) |
| Redis (rate-limit) | n/a (efêmero; reconstruído) | imediato | fail-secure: `skipOnError=false` nega sob falha |
| Object storage de mídia | herda backup do bucket (versionamento S3) | ≤ 4h | replicação/versionamento do provider |
| Segredos (.env) | n/a | manual | rotação via variáveis de ambiente + redeploy |

## Prova ponta-a-ponta (Final-5)

`infra/scripts/dr-e2e.sh` (workflow `.github/workflows/dr-e2e.yml`, semanal + manual):
backup → checksum → destroy → restore → estrutura (8 tabelas incl. DLQ) →
integrity queries → boot da app → smoke (`/health` + `/readiness.ready=true`) →
comparação de fixture (message/outbox/DLQ). Falha o CI se qualquer etapa falhar;
duração registrada no log. Evidência de execução: artifacts do workflow.

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
