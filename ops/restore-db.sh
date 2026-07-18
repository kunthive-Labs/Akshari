#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash ops/restore-db.sh path/to/fontscape.dump" >&2
  exit 1
fi

docker compose exec -T db pg_restore -U fontscape -d fontscape --clean --if-exists < "$1"
echo "Restore complete."
