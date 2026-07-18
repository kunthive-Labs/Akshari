#!/usr/bin/env bash
set -euo pipefail

backup_dir="${BACKUP_DIR:-./backups}"
stamp="$(date +%Y-%m-%dT%H-%M-%S)"
mkdir -p "$backup_dir"
umask 077

docker compose exec -T db pg_dump -U fontscape -d fontscape --format=custom > "$backup_dir/fontscape-$stamp.dump"
echo "Backup written to $backup_dir/fontscape-$stamp.dump"
