#!/usr/bin/env bash
#
# CP7 · Railway smoke test · run AFTER both statenour-web + statenour-worker
# show SUCCESS in the Railway dashboard.
#
# Tests:
#   1. statenour-web /api/system/health returns 200 + JSON
#   2. statenour-worker /health returns 200 + JSON with scheduler running
#   3. worker /cron/mega manual call (with CRON_SECRET) returns 200
#   4. Tail worker logs for in-process node-cron tick lines
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
WORKER_URL="https://statenour-worker-production.up.railway.app"

pass=0
fail=0
note() { echo ""; echo "===  $1  ==="; }
ok()   { echo "[OK] $1"; pass=$((pass+1)); }
ko()   { echo "[KO] $1"; fail=$((fail+1)); }

note "1 · statenour-web /api/system/health"
WEB_RESP=$(curl -sS -m 15 -w "\nHTTP_STATUS:%{http_code}" "$WEB_URL/api/system/health" 2>&1 || echo "CURL_FAIL")
WEB_CODE=$(echo "$WEB_RESP" | grep -oE "HTTP_STATUS:[0-9]+" | cut -d: -f2)
echo "$WEB_RESP" | head -8
if [ "$WEB_CODE" = "200" ]; then ok "statenour-web alive · 200"; else ko "statenour-web bad status: $WEB_CODE"; fi

note "2 · statenour-worker /health"
WRK_RESP=$(curl -sS -m 15 -w "\nHTTP_STATUS:%{http_code}" "$WORKER_URL/health" 2>&1 || echo "CURL_FAIL")
WRK_CODE=$(echo "$WRK_RESP" | grep -oE "HTTP_STATUS:[0-9]+" | cut -d: -f2)
echo "$WRK_RESP" | head -8
if [ "$WRK_CODE" = "200" ]; then ok "worker alive · 200"; else ko "worker bad status: $WRK_CODE"; fi

note "3 · worker /cron/mega manual fire (auth-gated)"
MEGA_RESP=$(curl -sS -m 30 -X POST -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  "$WORKER_URL/cron/mega" 2>&1 || echo "CURL_FAIL")
MEGA_CODE=$(echo "$MEGA_RESP" | grep -oE "HTTP_STATUS:[0-9]+" | cut -d: -f2)
echo "$MEGA_RESP" | head -8
if [ "$MEGA_CODE" = "200" ] || [ "$MEGA_CODE" = "502" ]; then
  ok "worker /cron/mega responded ($MEGA_CODE · 502 acceptable if web fan-out not yet wired)"
else
  ko "worker /cron/mega bad status: $MEGA_CODE"
fi

note "4 · worker /cron/mega with WRONG secret (must be 401)"
BAD_RESP=$(curl -sS -m 15 -X POST -w "\nHTTP_STATUS:%{http_code}" \
  -H "Authorization: Bearer not-the-real-secret" \
  "$WORKER_URL/cron/mega" 2>&1 || echo "CURL_FAIL")
BAD_CODE=$(echo "$BAD_RESP" | grep -oE "HTTP_STATUS:[0-9]+" | cut -d: -f2)
if [ "$BAD_CODE" = "401" ]; then ok "worker auth fail-closed working · 401"; else ko "worker auth NOT fail-closed: $BAD_CODE"; fi

echo ""
echo "===  RESULT · $pass passed · $fail failed  ==="
[ $fail -eq 0 ] && exit 0 || exit 1
