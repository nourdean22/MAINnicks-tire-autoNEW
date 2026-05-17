#!/bin/bash
# Manual master catch-up — fast-forward statenour-master to codex/ollama-local HEAD.
#
# Use when .github/workflows/mirror-to-master.yml failed to fire
# (missing permissions, first-run bootstrap, etc.) and Vercel production
# needs to deploy the latest codex work now.
#
# Safety:
#   · Fast-forward only — refuses to push if master has diverged.
#   · Prompts before pushing unless --yes is passed.
#
# Usage:
#   bash scripts/sync-master.sh           # interactive
#   bash scripts/sync-master.sh --yes     # skip prompt

set -e

AUTO_YES="${1:-}"

echo ""
echo "🔍  sync-master · fetching latest refs..."
git fetch origin -q

CODEX_SHA=$(git rev-parse origin/codex/ollama-local)
MASTER_SHA=$(git rev-parse origin/statenour-master)

echo "   codex/ollama-local : $CODEX_SHA"
echo "   statenour-master   : $MASTER_SHA"

if [ "$CODEX_SHA" = "$MASTER_SHA" ]; then
  echo "✅  master already at codex HEAD — nothing to sync"
  exit 0
fi

# Is master an ancestor of codex? Otherwise we'd clobber history.
if ! git merge-base --is-ancestor "$MASTER_SHA" "$CODEX_SHA"; then
  echo "❌  statenour-master has diverged from codex/ollama-local"
  echo "    master commits not reachable from codex"
  echo "    refuse to overwrite — resolve manually"
  exit 1
fi

# How many commits are we about to fast-forward?
AHEAD=$(git rev-list --count "$MASTER_SHA..$CODEX_SHA")
echo "   → fast-forward will advance master by $AHEAD commits"
echo ""

if [ "$AUTO_YES" != "--yes" ] && [ "$AUTO_YES" != "-y" ]; then
  read -p "proceed? (y/N) " -n 1 -r ANS
  echo ""
  if [[ ! $ANS =~ ^[Yy]$ ]]; then
    echo "aborted"
    exit 0
  fi
fi

echo "🚀  pushing codex/ollama-local → statenour-master..."
git push origin "$CODEX_SHA:refs/heads/statenour-master"

echo ""
echo "✅  synced · Vercel production will pick up $CODEX_SHA"
