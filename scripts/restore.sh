#!/bin/bash
# PostgreSQL Restore Script for CVG Connect Desk
# Usage: ./scripts/restore.sh <backup_file> [--dry-run]
set -euo pipefail

# Configuration
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-connect_desk}"
POSTGRES_DB="${POSTGRES_DB:-connect_desk_db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

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
    if ! command -v pg_restore &> /dev/null; then
        log_error "pg_restore not found. Install PostgreSQL client."
        exit 1
    fi
}

# Validate backup file
validate_backup() {
    local backup_file="$1"

    if [ ! -f "$backup_file" ]; then
        log_error "Backup file not found: $backup_file"
        exit 1
    fi

    # Check if file is a valid gzip
    if ! file "$backup_file" | grep -q "gzip"; then
        log_error "File is not a valid gzip archive: $backup_file"
        exit 1
    fi

    log_info "Backup file validated: $backup_file"
}

# List available backups
list_backups() {
    log_info "Available backups in $BACKUP_DIR:"
    ls -lh "$BACKUP_DIR"/backup_*.sql.gz 2>/dev/null || log_warn "No backups found"
}

# Perform restore
perform_restore() {
    local backup_file="$1"
    local dry_run="${2:-false}"

    log_info "Starting restore to database: $POSTGRES_DB"
    log_info "Backup file: $backup_file"

    if [ "$dry_run" = "true" ]; then
        log_warn "DRY RUN mode - no changes will be made"
        log_info "Would execute:"
        log_info "  gunzip -c $backup_file | pg_restore -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB --clean --if-exists"
        return
    fi

    # Check database connectivity
    if ! PGPASSWORD="${POSTGRES_PASSWORD}" pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" &> /dev/null; then
        log_error "Cannot connect to database. Check POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD"
        exit 1
    fi

    # Confirm before destructive action
    log_warn "This will DROP existing tables and restore from backup."
    read -p "Are you sure? Type 'yes' to confirm: " confirm

    if [ "$confirm" != "yes" ]; then
        log_info "Restore cancelled"
        exit 0
    fi

    export PGPASSWORD="${POSTGRES_PASSWORD}"

    # Drop existing objects and restore
    gunzip -c "$backup_file" | pg_restore \
        -h "$POSTGRES_HOST" \
        -p "$POSTGRES_PORT" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        --clean \
        --if-exists \
        --no-owner \
        --no-acl \
        2>/dev/null

    log_info "Restore completed successfully"
}

# Main execution
main() {
    log_info "=========================================="
    log_info "  CVG Connect Desk - PostgreSQL Restore"
    log_info "=========================================="

    check_prerequisites

    case "${1:-}" in
        list)
            list_backups
            ;;
        --dry-run)
            log_error "Usage: $0 <backup_file> [--dry-run]"
            exit 1
            ;;
        "")
            log_error "Usage: $0 <backup_file> [--dry-run]"
            echo ""
            echo "Available backups:"
            list_backups
            exit 1
            ;;
        *)
            backup_file="$1"
            dry_run="${2:-false}"
            validate_backup "$backup_file"
            perform_restore "$backup_file" "$dry_run"
            ;;
    esac
}

main "$@"