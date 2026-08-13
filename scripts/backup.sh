#!/bin/bash
# PostgreSQL Backup Script for CVG Connect Desk
# Usage: ./scripts/backup.sh [optional_backup_name]
set -euo pipefail

# Configuration
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-connect_desk}"
POSTGRES_DB="${POSTGRES_DB:-connect_desk_db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Timestamp for backup file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${1:-backup_${TIMESTAMP}}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql.gz"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    if ! command -v pg_dump &> /dev/null; then
        log_error "pg_dump not found. Install PostgreSQL client."
        exit 1
    fi

    if ! command -v gzip &> /dev/null; then
        log_error "gzip not found."
        exit 1
    fi
}

# Create backup directory
ensure_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        log_info "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
    fi
}

# Perform backup
perform_backup() {
    log_info "Starting backup of database: $POSTGRES_DB"
    log_info "Backup file: $BACKUP_FILE"

    # Check database connectivity
    if ! PGPASSWORD="${POSTGRES_PASSWORD}" pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" &> /dev/null; then
        log_error "Cannot connect to database. Check POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD"
        exit 1
    fi

    # Export PGPASSWORD for pg_dump
    export PGPASSWORD="${POSTGRES_PASSWORD}"

    # Perform backup with compression
    pg_dump \
        -h "$POSTGRES_HOST" \
        -p "$POSTGRES_PORT" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        --format=custom \
        --compress=9 \
        --no-owner \
        --no-acl \
        --exclude-table='outbox_events' \
        --exclude-table='dead_letters' \
        2>/dev/null | gzip > "$BACKUP_FILE"

    if [ -f "$BACKUP_FILE" ]; then
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        log_info "Backup completed successfully: $BACKUP_FILE ($BACKUP_SIZE)"
    else
        log_error "Backup failed"
        exit 1
    fi
}

# Cleanup old backups
cleanup_old_backups() {
    log_info "Cleaning up backups older than $RETENTION_DAYS days"

    find "$BACKUP_DIR" -name "backup_*.sql.gz" -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

    log_info "Cleanup completed"
}

# Main execution
main() {
    log_info "=========================================="
    log_info "  CVG Connect Desk - PostgreSQL Backup"
    log_info "=========================================="

    check_prerequisites
    ensure_backup_dir
    perform_backup
    cleanup_old_backups

    log_info "Backup process completed successfully"
}

main "$@"