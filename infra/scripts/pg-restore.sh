#!/usr/bin/env bash
# Phase 16 — restore PostgreSQL a partir de backup pg-backup.sh.
# Uso: POSTGRES_URL=... BACKUP_FILE=/backups/connect_desk_TS.dump ./pg-restore.sh
# Segurança: exige confirmação explícita, exceto com I_UNDERSTAND_DESTROY_DATA=1
# (para restores automatizados em banco efêmero de teste).
set -euo pipefail

: "${POSTGRES_URL:?POSTGRES_URL é obrigatório}"
: "${BACKUP_FILE:?BACKUP_FILE é obrigatório}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[pg-restore] ERRO: arquivo não encontrado: $BACKUP_FILE" >&2
  exit 2
fi

if [ -f "$BACKUP_FILE.sha256" ]; then
  echo "[pg-restore] verificando checksum..."
  sha256sum -c "$BACKUP_FILE.sha256"
else
  echo "[pg-restore] AVISO: sem .sha256 — checksum não verificado" >&2
fi

if [ "${I_UNDERSTAND_DESTROY_DATA:-0}" != "1" ]; then
  echo "[pg-restore] Isso APAGA e recria o schema público do banco alvo." >&2
  read -r -p "Digite o nome do arquivo de backup para confirmar: " CONFIRM
  EXPECTED="$(basename "$BACKUP_FILE")"
  if [ "$CONFIRM" != "$EXPECTED" ]; then
    echo "[pg-restore] confirmação divergente — abortado." >&2
    exit 3
  fi
fi

echo "[pg-restore] restaurando $BACKUP_FILE ..."
pg_restore --clean --if-exists --no-owner --dbname="$POSTGRES_URL" "$BACKUP_FILE"

echo "[pg-restore] validando tabelas críticas..."
TABLES="$(psql "$POSTGRES_URL" -tAX -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('users','messages','conversations','outbox_events','audit_logs');")"
if [ "$TABLES" != "5" ]; then
  echo "[pg-restore] ERRO: validação falhou (tabelas críticas: $TABLES/5)" >&2
  exit 4
fi

echo "[pg-restore] OK: restore + validação concluídos."
