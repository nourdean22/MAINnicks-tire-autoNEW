#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

INSTALL=0
if [[ "${1:-}" == "--install" ]]; then
  INSTALL=1
fi

echo "[bootstrap] repo=$ROOT"
echo "[bootstrap] node=$(node --version)"
node -e 'const m=Number(process.versions.node.split(".")[0]); if(m<24){console.error("Node 24+ required");process.exit(1)}'

command -v git >/dev/null || { echo "git missing"; exit 1; }
command -v corepack >/dev/null || { echo "corepack missing"; exit 1; }

PNPM_VERSION="$(corepack pnpm --version)"
echo "[bootstrap] pnpm=$PNPM_VERSION"

if [[ "$INSTALL" == "1" ]]; then
  echo "[bootstrap] installing locked workspace dependencies"
  corepack pnpm install --frozen-lockfile
fi

node scripts/dev/doctor.mjs

if [[ "$INSTALL" == "1" ]]; then
  echo "[bootstrap] running cross-agent policy verification"
  corepack pnpm agent:verify
fi

echo "[bootstrap] complete"
