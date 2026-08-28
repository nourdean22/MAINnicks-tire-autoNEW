#!/usr/bin/env bash
# Warm a `next dev` server's routes before handing it to Playwright, and tell
# apart the two OPPOSITE reasons a warm request can fail to return.
#
# WHY THIS EXISTS
#
# The loop this replaces lived inline in .github/workflows/e2e-statenour.yml and
# could not distinguish a dead server from a live server with one wedged route.
# It tested `[ "$rc" -ne 0 ] || [ "$code" = "000" ]` and printed ONE message for
# both: "dev server stopped answering". That message was wrong every time it
# fired in the sample below, and being wrong is what kept the bug open.
#
#   curl rc=7  (or 000)  the server is GONE. Nothing downstream can be trusted.
#   curl rc=28           the server did not ANSWER IN TIME. It may be perfectly
#                        alive with a single route's compile wedged — which is
#                        what was actually happening.
#
# THE SAMPLE (2026-08-28 · statenour e2e · runs 33203747058 / 33200855271 /
# 33192651269 / 33115876891 — 4 of 4, back to 08-27)
#
#   warm /api/intel -> 000 (curl rc=28)      · rc=28 = TIMEOUT, not refused
#   next dev log, last line: `○ Compiling /api/intel ...`, then nothing
#
# The route's own handler never ran: apiHandler prints `✓ start GET <path>`
# before it does any work, and /api/system/rate-limits — the SAME
# apiHandler(..., { auth: "owner" }) wrapper — printed it 20s earlier. So the
# wedge is upstream of the handler, in the compile.
#
# And the compile is trivial: /api/intel adds 671 lines across 4 files and NO
# new dependencies (apiHandler, prisma, auth-guard, logger, zod, nanoid were all
# compiled already). On the passing re-run of the identical commit it warmed in
# 330ms. 330ms vs >300s for the same compile is bimodal — a deadlock, not
# slowness. Raising the timeout cannot help; it only converts a 5-minute failure
# into a 30-minute job timeout.
#
# Memory is the accomplice, not the cause, and the passing run proves it: it had
# the LEAST free memory at that point (526MB, vs 634-843MB in all four
# failures) and compiled the route fine. Peak next-server RSS is 6.1-6.3GB on a
# ~7GB runner in both outcomes.
#
# WHAT THIS DOES NOT FIX
#
# The wedge is inside Turbopack's dev compiler, same as the route-resolution
# latch documented in wait-for-dev-server.sh. This script does not repair it and
# does not hide it: every route must still answer, the recovery is announced
# loudly, and the job still fails if a route stays wedged. It makes CI honest
# about WHICH condition happened, and recovers from the transient one.
#
# USAGE (env only, so the workflow keeps its own tuning + comments):
#   ROUTES         required · newline-separated paths (query strings welcome;
#                  surrounding whitespace is trimmed, so the list may be indented)
#   BASE_URL       default http://localhost:3001
#   HEALTH_PATH    default /api/system/heartbeat
#   LOG_FILE       default /tmp/next-start.log
#   ROUTE_TIMEOUT  default 120 · seconds one route may take to answer
#   HEALTH_TIMEOUT default 30
#   RETRIES        default 1   · re-requests of a wedged route before restarting
#   RESTART_CMD    optional    · re-launch the server; without it a stuck route
#                               is fatal immediately (no silent skip either way)
#   MAX_RESTARTS   default 1
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
HEALTH_PATH="${HEALTH_PATH:-/api/system/heartbeat}"
LOG_FILE="${LOG_FILE:-/tmp/next-start.log}"
ROUTE_TIMEOUT="${ROUTE_TIMEOUT:-120}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-30}"
RETRIES="${RETRIES:-1}"
RESTART_CMD="${RESTART_CMD:-}"
MAX_RESTARTS="${MAX_RESTARTS:-1}"

if [ -z "${ROUTES:-}" ]; then
  echo "::error::warm-routes: ROUTES is required" >&2
  exit 2
fi

# `ps -C node` NEVER matched the dev server — Next renames its process to
# `next-server`, so a 43MB reading once "refuted" a memory theory while
# measuring the wrong process. Report free memory + the two largest processes
# by RSS instead, whatever they happen to be called.
mem() {
  if ! command -v free >/dev/null 2>&1; then echo "mem=unavailable"; return; fi
  echo "$(free -m | awk '/^Mem:/ {print "avail="$7"MB"}') · $(ps -eo rss=,comm= --sort=-rss 2>/dev/null | head -2 | awk '{printf "%s:%dMB ", $2, $1/1024}')"
}

log_tail() {
  echo "--- $LOG_FILE tail ---"
  tail -40 "$LOG_FILE" 2>/dev/null || true
}

# Sets CODE and RC. Capture curl's EXIT STATUS; do not infer failure from the
# body. On a connect failure or timeout curl still emits its --write-out format
# ("000") AND returns nonzero, so `$(curl ... || echo 000)` yields "000000" and
# an equality check on it can never match — that exact no-op shipped once.
request() {
  local path="$1" timeout="$2"
  RC=0
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -m "$timeout" "${BASE_URL}${path}") || RC=$?
}

# 0 = health endpoint answers 200 (server is alive), 1 = it does not.
server_alive() {
  request "$HEALTH_PATH" "$HEALTH_TIMEOUT"
  HEALTH_CODE="$CODE"
  HEALTH_RC="$RC"
  [ "$RC" -eq 0 ] && [ "$CODE" = "200" ]
}

die_server_gone() {
  local path="$1"
  # Wording preserved from the inline loop deliberately: this is the message
  # that condition has always deserved, and it is now printed ONLY for it.
  echo "::error::dev server stopped answering while warming $path — $HEALTH_PATH gave ${HEALTH_CODE:-none} (curl rc=${HEALTH_RC:-?}), aborting rather than running Playwright against a dead server"
  log_tail
  exit 1
}

restarts=0

# Warm one path. Returns 0 warmed · 1 still wedged after RETRIES (server alive).
# Exits nonzero from inside on a genuinely dead server — nothing downstream can
# be trusted at that point, so there is no caller worth returning to.
warm() {
  local path="$1" attempt=0 rc code
  while :; do
    request "$path" "$ROUTE_TIMEOUT"
    # Snapshot IMMEDIATELY. server_alive issues its own request through the same
    # two globals, so reading $RC after probing health reads the HEALTH result
    # and classifies the wrong thing. The canary's RECOVERS-by-restart case
    # caught exactly that: a timed-out route reported as "rc=0 (code 200) ...
    # broken, not slow".
    rc="$RC"; code="$CODE"
    echo "  warm $path -> ${code:-none} (curl rc=$rc) · $(mem)"

    # Status is irrelevant — compilation happens regardless of auth. Any HTTP
    # response at all means the route compiled and the handler answered.
    if [ "$rc" -eq 0 ] && [ "$code" != "000" ]; then return 0; fi

    # Something went wrong. ASK THE SERVER which state it is in before saying
    # anything about it — the old loop asserted "stopped answering" from
    # curl's exit code alone, and was wrong in 4 of 4 sampled failures.
    if ! server_alive; then die_server_gone "$path"; fi

    if [ "$rc" -ne 28 ]; then
      # Alive, but this route failed without timing out (rc=52 empty reply,
      # rc=56 reset, ...). Not a wedge and not a dead server; a retry would
      # only paper over it.
      echo "::error::route $path failed with curl rc=$rc (code ${code:-none}) while $HEALTH_PATH answered 200 — the server is alive and this route is broken, not slow"
      log_tail
      exit 1
    fi

    # TIMEOUT with the server alive: the wedge. This is the condition the
    # inline loop mislabelled as a dead server.
    if [ "$attempt" -ge "$RETRIES" ]; then
      echo "::warning::route $path did not answer in ${ROUTE_TIMEOUT}s across $((attempt + 1)) attempt(s), while $HEALTH_PATH kept answering 200 — the server is ALIVE and this route's compile is wedged"
      return 1
    fi
    attempt=$((attempt + 1))
    echo "::warning::route $path timed out after ${ROUTE_TIMEOUT}s but $HEALTH_PATH still returns 200 — server ALIVE, route compile wedged · retry $attempt/$RETRIES"
  done
}

warm_all() {
  while IFS= read -r line; do
    # Trim surrounding whitespace so the caller may INDENT the list. A GitHub
    # Actions `run: |` block is a YAML block scalar: a heredoc body at column 0
    # terminates it and the workflow stops parsing. Paths themselves never
    # contain whitespace, so trimming cannot lose one.
    p="${line#"${line%%[![:space:]]*}"}"
    p="${p%"${p##*[![:space:]]}"}"
    [ -z "$p" ] && continue
    warm "$p" || return 1
  done <<EOF
$ROUTES
EOF
  return 0
}

while :; do
  if warm_all; then break; fi

  if [ -z "$RESTART_CMD" ] || [ "$restarts" -ge "$MAX_RESTARTS" ]; then
    echo "::error::a route never finished compiling and the dev server is still alive — this is the Turbopack dev-compile wedge, not a test failure and not a dead server. Refusing to run Playwright against a server with an unwarmed route."
    log_tail
    exit 1
  fi

  restarts=$((restarts + 1))
  echo "::warning::restart $restarts/$MAX_RESTARTS — clearing the wedged compiler state and re-warming every route from cold"
  # wait-for-dev-server.sh starts its own `tail -f` and truncates the log. Kill
  # the previous one first or its output doubles for the rest of the job.
  TAILPID="$(cat /tmp/.dev-tail.pid 2>/dev/null || echo "")"
  [ -n "$TAILPID" ] && kill "$TAILPID" 2>/dev/null
  if ! eval "$RESTART_CMD"; then
    echo "::error::restart command failed — see above"
    exit 1
  fi
done

# Liveness gate. The heartbeat used to be checked only BEFORE the warm loops, so
# a server that died during them went undetected and surfaced six minutes later
# as a pile of unrelated Playwright failures.
if ! server_alive; then
  echo "::error::dev server is not healthy after warmup (heartbeat -> ${HEALTH_CODE:-none}, curl rc=${HEALTH_RC:-?}) — aborting before Playwright"
  log_tail
  exit 1
fi
echo "post-warm heartbeat -> $HEALTH_CODE · server healthy"
