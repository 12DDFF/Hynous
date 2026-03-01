#!/usr/bin/env bash
# Automated backup for satellite databases.
# Run daily via cron: 0 3 * * * /path/to/backup_satellite.sh
#
# Uses SQLite's .backup command (online, consistent, WAL-safe).
# Keeps 7 daily backups locally. Weekly scp to remote (if configured).

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

STORAGE_DIR="${HYNOUS_STORAGE:-/root/hynous/storage}"
BACKUP_DIR="${HYNOUS_BACKUP:-/root/hynous/backups}"
KEEP_DAYS=7

# Remote backup (optional)
REMOTE_HOST="${BACKUP_REMOTE_HOST:-}"
REMOTE_DIR="${BACKUP_REMOTE_DIR:-}"

# ─── Functions ───────────────────────────────────────────────────────────────

backup_db() {
    local db_name="$1"
    local db_path="${STORAGE_DIR}/${db_name}"
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_path="${BACKUP_DIR}/${db_name%.db}_${timestamp}.db"

    if [[ ! -f "$db_path" ]]; then
        echo "SKIP: ${db_path} does not exist"
        return
    fi

    echo "Backing up ${db_name}..."
    sqlite3 "$db_path" ".backup '${backup_path}'"
    echo "  → ${backup_path} ($(du -h "$backup_path" | cut -f1))"
}

prune_old() {
    local pattern="$1"
    echo "Pruning backups older than ${KEEP_DAYS} days matching ${pattern}..."
    find "$BACKUP_DIR" -name "${pattern}" -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
}

# ─── Main ────────────────────────────────────────────────────────────────────

mkdir -p "$BACKUP_DIR"

echo "=== Satellite Backup $(date) ==="

# Backup all satellite databases
backup_db "satellite.db"
backup_db "hynous-data.db"

# Prune old backups
prune_old "satellite_*.db"
prune_old "hynous-data_*.db"

# Weekly remote backup (on Sundays)
if [[ "$(date +%u)" == "7" ]] && [[ -n "$REMOTE_HOST" ]] && [[ -n "$REMOTE_DIR" ]]; then
    echo "Weekly remote backup to ${REMOTE_HOST}:${REMOTE_DIR}..."
    latest_sat=$(ls -t "${BACKUP_DIR}"/satellite_*.db 2>/dev/null | head -1)
    latest_dl=$(ls -t "${BACKUP_DIR}"/hynous-data_*.db 2>/dev/null | head -1)
    if [[ -n "$latest_sat" ]]; then
        scp "$latest_sat" "${REMOTE_HOST}:${REMOTE_DIR}/"
    fi
    if [[ -n "$latest_dl" ]]; then
        scp "$latest_dl" "${REMOTE_HOST}:${REMOTE_DIR}/"
    fi
    echo "Remote backup complete."
fi

echo "=== Backup complete ==="
