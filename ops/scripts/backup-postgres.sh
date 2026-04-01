#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/trading-terminal}
PGDATABASE=${PGDATABASE:-trading_cockpit}
PGUSER=${PGUSER:-trading}
PGHOST=${PGHOST:-127.0.0.1}
PGPORT=${PGPORT:-5432}
RETENTION_DAYS=${RETENTION_DAYS:-14}

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/${PGDATABASE}-${STAMP}.sql.gz"

PGPASSWORD=${PGPASSWORD:-} pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --format=plain \
  --no-owner \
  --no-privileges | gzip > "$OUT"

find "$BACKUP_DIR" -type f -name "${PGDATABASE}-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "Backup written: $OUT"
