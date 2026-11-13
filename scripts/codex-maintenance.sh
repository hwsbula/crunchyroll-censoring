#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -d node_modules ]]; then
  echo 'Dependencies are missing. Run bash scripts/codex-setup.sh with package download access.' >&2
  exit 1
fi

# No downloads or implicit updates. Rerun setup after changing package-lock.json.
npm ls --depth=0 --offline >/dev/null
npm run check
