#!/usr/bin/env bash
#
# CP7 · Railway smoke test · run AFTER both statenour-web + statenour-worker
# show SUCCESS in the Railway dashboard.
#
# Tests:
#   1. statenour-web /api/system/health returns 200 + JSON
#   2. statenour-web heartbeat reports a fresh persisted private-worker receipt
#   3. direct web brain-bus-drain cron call (with CRON_SECRET) returns 200
#   4. same cron with a wrong secret returns 401
#
# Requires: .cron-secret.local in repo root (gitignored · contains hex secret)
#
# Usage:  bash scripts/railway-smoke-test.sh
set -u  # not -e · we want every test to run even if earlier ones fail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRET="$(cat "$REPO_ROOT/.cron-secret.local" 2>/dev/null | tr -d '\r\n')"
if [ -z "$SECRET" ]; then
  echo "[!] .cron-secret.local missing or empty · cannot run cron-auth tests"
  exit 1
fi

WEB_URL="https://statenour-web-production.up.railway.app"
HEARTBEAT_URL="$WEB_URL/api/system/heartbeat"

pass=0
fail=0
note() { echo ""; echo "===  $1  ==="; }
ok()   { echo "[OK] $1"; pass=$((pass+1)); }
ko()   { echo "[KO] $1"; fail=$((fail+1)); }

note "1 · statenour-web /api/system/heartbeat (public uptime endpoint)"
WEB_RESP=$(curl -sS -m 15 -w "\nHTTP_STATUS:%{http_code}" "$WEB_URL/api/system/heartbeat" 2>&1 || echo "CURL_FAIL")
WEB_CODE=$(echo "$WEB_RESP" | grep -oE "HTTP_STATUS:[0-9]+" | cut -d: -f2)
echo "$WEB_RESP" | head -8
if [ "$WEB_CODE" = "200" ]; then ok "statenour-web alive · 200"; else ko "statenour-web bad status: $WEB_CODE"; fi

note "2 · private worker freshness via public web heartbeat"
WRK_RESP=$(curl -sS -m 15 -w "\nHTTP_STATUS:%{http_code}" "$HEARTBEAT_URL" 2>&1 || echo "CURL_FAIL")
WRK_CODE=$(echo "$WRK_RESP" | grep -oE "HTTP_STATUS:[0-9]+" | cut -d: -f2)
WRK_BODY=$(echo "$WRK_RESP" | sed '/HTTP_STATUS:/d')
echo "$WRK_RESP" | head -8
if [ "$WRK_CODE" = "200" ] && echo "$WRK_BODY" | grep -Eq '"worker"[[:space:]]*:[[:space:]]*\{[^}]*"status"[[:space:]]*:[[:space:]]*"fresh"'; then
  ok "private worker has a fresh persisted forward receipt"
else
  ko "private worker receipt stale/missing · web heartbeat status: $WRK_CODE"
fi

note "3 · direct web brain-bus-drain manual fire (auth-gated)"
DRAIN_RESP=$(curl -sS -m 30 -X GET -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer $SECRET" \
  "$WEB_URL/api/cron/brain-bus-drain" 2>&1 || echo "CURL_FAIL")
DRAIN_CODE=$(echo "$DRAIN_RESP" | grep -oE "HTTP_STATUS:[0-9]+" | cut -d: -f2)
echo "$DRAIN_RESP" | head -8
if [ "$DRAIN_CODE" = "200" ]; then
  ok "web brain-bus-drain responded 200"
else
  ko "web brain-bus-drain bad status: $DRAIN_CODE"
fi

note "4 · web brain-bus-drain with WRONG secret (must be 401)"
BAD_RESP=$(curl -sS -m 15 -X GET -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer not-the-real-secret" \
  "$WEB_URL/api/cron/brain-bus-drain" 2>&1 || echo "CURL_FAIL")
BAD_CODE=$(echo "$BAD_RESP" | grep -oE "HTTP_STATUS:[0-9]+" | cut -d: -f2)
if [ "$BAD_CODE" = "401" ]; then ok "web cron auth fail-closed working · 401"; else ko "web cron auth NOT fail-closed: $BAD_CODE"; fi

echo ""
echo "===  RESULT · $pass passed · $fail failed  ==="
[ $fail -eq 0 ] && exit 0 || exit 1
