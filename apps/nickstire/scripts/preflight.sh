#!/usr/bin/env bash
# ─── Pre-Deploy Preflight Check ────────────────────
# Run before pushing to verify deploy readiness.
# Usage: bash scripts/preflight.sh

set -uo pipefail

PASS=0
FAIL=0

green() { echo -e "\033[32m  ✓ $1\033[0m"; ((PASS++)); }
red()   { echo -e "\033[31m  ✗ $1\033[0m"; ((FAIL++)); }

echo ""
echo "═══════════════════════════════════════════"
echo "  PREFLIGHT CHECK"
echo "═══════════════════════════════════════════"
echo ""

# TypeScript
echo "── TypeScript ──"
ERRORS=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
if [ "$ERRORS" = "0" ]; then green "Zero TS errors"; else red "$ERRORS TS errors"; fi

# Build
echo "── Build ──"
if pnpm build > /dev/null 2>&1; then green "Build succeeds"; else red "Build FAILED"; fi

# Output exists
echo "── Build Output ──"
if [ -f "dist/index.js" ]; then green "dist/index.js exists"; else red "dist/index.js missing"; fi
if [ -d "dist/public" ]; then green "dist/public/ exists"; else red "dist/public/ missing"; fi

# cross-env in production deps
echo "── Dependencies ──"
if python -c "import json; d=json.load(open('package.json')); exit(0 if 'cross-env' in d.get('dependencies',{}) else 1)" 2>/dev/null; then
  green "cross-env in production deps"
else
  red "cross-env NOT in production deps — start script will fail"
fi

# engines.node specified
if python -c "import json; d=json.load(open('package.json')); exit(0 if d.get('engines',{}).get('node') else 1)" 2>/dev/null; then
  green "engines.node specified"
else
  red "engines.node missing — Railway may pick wrong version"
fi

# .env.example exists and is current
echo "── Config ──"
if [ -f ".env.example" ]; then green ".env.example exists"; else red ".env.example missing"; fi

# No secrets in tracked files
SECRETS=$(git diff --cached --name-only 2>/dev/null | grep -E "\.env$|\.env\.local$|\.env\.production$" || true)
if [ -z "$SECRETS" ]; then green "No .env files staged"; else red "SECRET FILE STAGED: $SECRETS"; fi

# Summary
echo ""
echo "═══════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "  $PASS passed  $FAIL failed  ($TOTAL total)"
if [ "$FAIL" -gt 0 ]; then
  echo "  STATUS: NOT READY TO DEPLOY"
  exit 1
else
  echo "  STATUS: READY TO DEPLOY"
  exit 0
fi
