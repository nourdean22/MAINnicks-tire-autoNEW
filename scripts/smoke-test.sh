#!/usr/bin/env bash
# ─── Smoke Test Harness ─────────────────────────────────
# Validates core endpoints, auth gates, data shapes, and system health.
# Usage: bash scripts/smoke-test.sh [base_url]
# Default: http://localhost:3000

set -uo pipefail

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0
WARN=0

green() { echo -e "\033[32m  ✓ $1\033[0m"; ((PASS++)); }
red()   { echo -e "\033[31m  ✗ $1\033[0m"; ((FAIL++)); }
yellow(){ echo -e "\033[33m  ⚠ $1\033[0m"; ((WARN++)); }

check_status() {
  local name="$1" url="$2" expect="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$code" = "$expect" ]; then
    green "$name → $code"
  else
    red "$name → $code (expected $expect)"
  fi
}

check_json_field() {
  local name="$1" url="$2" field="$3" expect="$4"
  local val
  val=$(curl -s --max-time 10 "$url" 2>/dev/null | python -c "
import sys,json
try:
  d=json.load(sys.stdin)
  keys='$field'.split('.')
  for k in keys: d=d.get(k,{}) if isinstance(d,dict) else d
  print(d)
except: print('PARSE_ERROR')
" 2>/dev/null || echo "CURL_FAIL")
  if [ "$val" = "$expect" ]; then
    green "$name → $val"
  elif [ "$val" = "PARSE_ERROR" ] || [ "$val" = "CURL_FAIL" ]; then
    red "$name → $val"
  else
    yellow "$name → $val (expected $expect)"
  fi
}

check_json_exists() {
  local name="$1" url="$2" field="$3"
  local val
  val=$(curl -s --max-time 10 "$url" 2>/dev/null | python -c "
import sys,json
try:
  d=json.load(sys.stdin)
  keys='$field'.split('.')
  for k in keys: d=d.get(k,{}) if isinstance(d,dict) else d
  print('EXISTS' if d and d != {} else 'MISSING')
except: print('PARSE_ERROR')
" 2>/dev/null || echo "CURL_FAIL")
  if [ "$val" = "EXISTS" ]; then
    green "$name"
  else
    red "$name → $val"
  fi
}

echo ""
echo "═══════════════════════════════════════════"
echo "  SMOKE TEST — $BASE"
echo "═══════════════════════════════════════════"
echo ""

# ─── Connectivity ───
echo "── Connectivity ──"
check_status "Homepage" "$BASE/" "200"
check_status "SPA /cc" "$BASE/cc" "200"
check_status "SPA /admin" "$BASE/admin" "200"
check_status "API 404" "$BASE/api/nonexistent" "404"

# ─── Health ───
echo ""
echo "── Health ──"
check_json_field "DB up" "$BASE/api/health" "checks.database.status" "up"
check_json_exists "AI gateway status" "$BASE/api/health" "checks.aiGateway.status"
check_json_exists "Memory info" "$BASE/api/health" "memory.usedMB"

# ─── Auth Gates ───
echo ""
echo "── Auth Gates (expect 403 without session) ──"
check_status "getOverview (no auth)" "$BASE/api/trpc/controlCenter.getOverview" "403"
check_status "getDailyBrief (no auth)" "$BASE/api/trpc/controlCenter.getDailyBrief" "403"
# toggleHabit is a mutation (POST) — GET returns 405, which is correct behavior
check_status "toggleHabit mutation (GET→405)" "$BASE/api/trpc/controlCenter.toggleHabit" "405"


# ─── PWA ───
echo ""
echo "── PWA ──"
check_json_field "Manifest name" "$BASE/manifest.json" "name" "Nick's Control Center"
check_json_field "Manifest start" "$BASE/manifest.json" "start_url" "/cc"
check_json_field "Manifest display" "$BASE/manifest.json" "display" "standalone"

# ─── Static Assets ───
echo ""
echo "── Assets ──"
check_status "favicon" "$BASE/favicon-32x32.png" "200"
check_status "apple-touch-icon" "$BASE/apple-touch-icon.png" "200"

# ─── Summary ───
echo ""
echo "═══════════════════════════════════════════"
TOTAL=$((PASS + FAIL + WARN))
echo "  $PASS passed  $FAIL failed  $WARN warnings  ($TOTAL total)"
if [ "$FAIL" -gt 0 ]; then
  echo "  STATUS: FAIL"
  exit 1
else
  echo "  STATUS: PASS"
  exit 0
fi
