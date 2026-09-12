#!/usr/bin/env bash
# Phase 16 — backup PostgreSQL (formato custom + retenção).
# Uso: POSTGRES_URL=... BACKUP_DIR=/backups RETENTION_DAYS=14 ./pg-backup.sh
# Requer: pg_dump (imagem postgres:15-alpine ou client local).
set -euo pipefail

: "${POSTGRES_URL:?POSTGRES_URL é obrigatório (ex: postgresql://user:pass@host:5432/db)}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/connect_desk_$STAMP.dump"
SHA_FILE="$FILE.sha256"

echo "[pg-backup] iniciando backup em $FILE"
pg_dump --format=custom --compress=9 --file="$FILE" "$POSTGRES_URL"
sha256sum "$FILE" > "$SHA_FILE"

echo "[pg-backup] limpando backups com mais de $RETENTION_DAYS dias"
find "$BACKUP_DIR" -maxdepth 1 -name 'connect_desk_*.dump' -mtime +"$RETENTION_DAYS" -print -delete || true
find "$BACKUP_DIR" -maxdepth 1 -name 'connect_desk_*.dump.sha256' -mtime +"$RETENTION_DAYS" -print -delete || true

echo "[pg-backup] OK: $FILE ($(du -h "$FILE" | cut -f1))"
