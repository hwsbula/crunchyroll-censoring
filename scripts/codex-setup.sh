#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { throw new Error("Use Node 24: nvm install && nvm use"); }'
npm ci

# Browser binaries need network access during environment preparation.
# Set CODEX_INSTALL_SYSTEM_DEPS=1 on Linux when the environment permits apt/sudo.
if [[ "${CODEX_INSTALL_SYSTEM_DEPS:-0}" == "1" ]]; then
  npx playwright install --with-deps chromium
else
  npx playwright install chromium
fi

npm run check
echo 'Setup complete. Run npm run test:e2e to verify the browser environment (npm run verify runs all checks).'
