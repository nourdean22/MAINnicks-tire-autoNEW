#!/bin/bash
set -e
echo "=== NICK'S TIRE & AUTO — PRE-PUSH VERIFICATION ==="
echo ""

echo "[1/4] Checking lockfile sync..."
pnpm install --frozen-lockfile 2>/dev/null
echo "  Lockfile is in sync"

echo "[2/4] Building..."
pnpm build 2>&1
echo "  Build passed"

echo "[3/4] Checking for global Twilio mount..."
if grep -q "app\.use(twilioWebhookRouter)" server/_core/index.ts 2>/dev/null; then
  echo "  FATAL: Global Twilio mount detected! This will break all routes."
  exit 1
fi
echo "  No global Twilio mount"

echo "[4/4] Git status..."
git status --short
echo "  Branch: $(git branch --show-current)"
echo ""

echo "=== ALL CHECKS PASSED. Safe to push. ==="
