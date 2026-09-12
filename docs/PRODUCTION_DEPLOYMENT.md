# PRODUCTION_DEPLOYMENT — CVG Connect Desk

## Pré-requisitos

`POSTGRES_PASSWORD`, `JWT_SECRET`, `CORS_ORIGIN` (obrigatórios — compose falha sem eles).
`WEBHOOK_SECRET` (webhook rejeita tudo sem ele), `ADMIN_BOOTSTRAP_EMAIL/PASSWORD` (seed fail-secure),
`METRICS_TOKEN` (recomendado), `DATABASE_URL`, `REDIS_URL`.

## Observabilidade e mídia em produção

- `OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` para traces no Collector (noop fora isso).
- `MEDIA_STORAGE_DRIVER=s3` + `S3_*` (MinIO/R2/S3); `MALWARE_SCANNER=clamav` + `CLAMAV_HOST/PORT`;
  `MEDIA_PIPELINE_ENABLED=true` para scan de data-URLs; documentos exigem CLEAN.
- `MEDIA_REQUIRE_SCAN` default `documents` (fail-secure).

## Subir

```bash
cp .env.production.example .env  # preencher segredos
docker compose up -d --build
docker compose ps                # healthy
curl https://<host>/health
```

## Hardening aplicado

- `read_only` + `tmpfs /tmp` nos node services; nginx com `NET_BIND_SERVICE` apenas.
- `cap_drop: ALL`, `no-new-privileges`. Postgres/Redis só em `127.0.0.1` (ou rede interna).
- TLS: terminar em reverse proxy externo (não incluso; web expõe :80).
- Healthchecks reais (api `/health`, worker SELECT 1, realtime `nc 8080`).

## Operação

Migrations via `db-init` (`completed-successfully`). Rollback de código é seguro (migrations
backward-compatible). Backup diário (`infra/scripts/pg-backup.sh` em cron).
Smoke pós-deploy: `pnpm test:e2e:smoke` + k6 (`e2e/load/smoke-load.js`).
