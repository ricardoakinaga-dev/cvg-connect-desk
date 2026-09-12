# DISASTER_RECOVERY — CVG Connect Desk

## RPO / RTO (formais)

| Ativo | RPO | RTO | Método |
|---|---|---|---|
| PostgreSQL | ≤ 24h (diário; apertar p/ 1h em produção crítica) | ≤ 2h | `pg-backup.sh` (custom+checksum+retenção) |
| Redis (rate-limit) | n/a (efêmero; reconstruído) | imediato | fail-secure: `skipOnError=false` nega sob falha |
| Object storage de mídia | herda backup do bucket (versionamento S3) | ≤ 4h | replicação/versionamento do provider |
| Segredos (.env) | n/a | manual | rotação via variáveis de ambiente + redeploy |

## Prova ponta-a-ponta (Release closure — EXECUTADA)

`infra/scripts/dr-e2e-node.mjs` (backup/restore via COPY nativo, sem depender de
pg_dump no host) — executado local no SHA da release:
**result PASS** (`artifacts/dr-e2e-report.json`): create → migrate → fixture
(11 tabelas: users, sessions, contacts, conversations, messages, outbox, acks,
DLQ, audit, media, AI approvals) → backup + SHA-256 → destroy → recreate →
restore → integridade ok → boot app + smoke → comparação fixture.
RPO 24h (delta de retenção de backup diário) · RTO 2h (meta).
Workflow `dr-e2e.yml` (scheduled semanal) espelha o fluxo e falha o CI;
`pg-backup.sh`/`pg-restore.sh` cobrem backup custom do cliente padrão.

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
