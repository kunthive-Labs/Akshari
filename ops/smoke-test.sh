#!/usr/bin/env bash
set -euo pipefail

base_url="${FONTSCAPE_URL:-http://127.0.0.1:3000}"

health="$(curl -fsS --max-time 15 "$base_url/api/health")"
search="$(curl -fsS --max-time 15 "$base_url/api/search?q=modern&limit=1")"

[[ "$health" == *'"status":"ok"'* ]]
[[ "$search" == *'"fonts"'* ]]

echo "Fontscape smoke test passed for $base_url"
