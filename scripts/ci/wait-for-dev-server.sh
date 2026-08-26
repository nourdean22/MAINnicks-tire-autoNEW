#!/usr/bin/env bash
# Start a dev server and wait for it to be genuinely serving — not merely
# listening — restarting it once if it comes up with a broken route table.
#
# WHY THIS EXISTS
#
# Every statenour e2e failure sampled on 2026-08-26 (runs 32983503600,
# 32894843745, 32876917977, 32683986110, 32605539562 — 5 of 5, back to 08-22)
# is one bug, and it is not a test failure: Playwright never ran. The dev
# server reports `✓ Ready in 430ms`, then the first request to a route that
# exists resolves to `/_not-found` (an 11.1s compile), and every subsequent
# request to that path answers 404 in ~40ms for the full 180s wait. The
# resolution LATCHES. Passing runs show zero 404s and answer 200 in ~1.9s.
#
# So the wait loop was waiting for a condition that could never arrive, and
# then reporting "server never came up" — which was false. It came up. It
# served 199 requests. Its route table was wrong.
#
# THE DISTINCTION THIS SCRIPT DRAWS
#
#   curl rc != 0     the port is not accepting yet. Normal during boot.
#                    Keep waiting; this is the state that resolves on its own.
#   HTTP 200         serving. Done.
#   any other code   LISTENING BUT WRONG. A 404 on a route that exists is not
#                    a slow compile — the ~40ms replies prove it is a cached
#                    negative. Waiting cannot fix it. Restart can.
#
# Conflating the first and third is what cost 180s and a red job per
# occurrence. They are opposite conditions: one is cured by patience, the
# other is made permanent by it.
#
# WHAT THIS DOES NOT FIX
#
# The latch itself is inside Next/Turbopack's route resolution. This script
# makes CI reliable and honest about which failure happened; it does not
# repair the upstream behaviour, and it does not hide it — every restart is
# announced loudly and the reason is printed.
#
# USAGE (all via env so the workflow keeps its own tuning + comments):
#   START_CMD    required · command to launch the server (backgrounded here)
#   PORT         default 3001
#   HEALTH_PATH  default /api/system/heartbeat
#   LOG_FILE     default /tmp/next-start.log
#   WORK_DIR     default . · also where a stale build dir is cleared from
#   LISTEN_WAIT  default 180 · seconds to allow before the port answers
#   SERVE_WAIT   default 60  · seconds a listening-but-wrong server may have
#   MAX_RESTARTS default 1
#   CLEAR_DIR    default .next · removed before a RESTART, never before the
#                first attempt (a healthy run pays nothing)
set -uo pipefail

PORT="${PORT:-3001}"
HEALTH_PATH="${HEALTH_PATH:-/api/system/heartbeat}"
LOG_FILE="${LOG_FILE:-/tmp/next-start.log}"
WORK_DIR="${WORK_DIR:-.}"
LISTEN_WAIT="${LISTEN_WAIT:-180}"
SERVE_WAIT="${SERVE_WAIT:-60}"
MAX_RESTARTS="${MAX_RESTARTS:-1}"
CLEAR_DIR="${CLEAR_DIR:-.next}"
TAIL_LOG="${TAIL_LOG:-1}"
URL="http://localhost:${PORT}${HEALTH_PATH}"

SERVER_PID=""
TAIL_PID=""

start_server() {
  # Truncate rather than append: the tail below streams this file, and a
  # restart's log must not be read as a continuation of the dead server's.
  : > "$LOG_FILE"
  ( cd "$WORK_DIR" && eval "nohup $START_CMD" >>"$LOG_FILE" 2>&1 & echo $! > /tmp/.dev-server.pid )
  SERVER_PID="$(cat /tmp/.dev-server.pid 2>/dev/null || echo "")"
  # Stream the server's own output INLINE so a heap abort or a stack trace is
  # visible while it happens, not after the job dies.
  if [ "$TAIL_LOG" = "1" ]; then
    tail -f "$LOG_FILE" | sed 's/^/  [next] /' &
    TAIL_PID=$!
    echo "$TAIL_PID" > /tmp/.dev-tail.pid
  fi
  echo "  started: pid=${SERVER_PID:-unknown} · log=$LOG_FILE"
}

# True when something still accepts on $PORT.
port_held() { curl -s -o /dev/null -m 1 "http://localhost:${PORT}/" 2>/dev/null; }

# Kill whatever holds the port, by whatever tool this box has.
#
# Killing $SERVER_PID alone is NOT enough and the first draft of this script
# proved it: `next dev` (like `pnpm exec` -> node) spawns children, the parent
# died, the port stayed held, the restarted server aborted with EADDRINUSE,
# and the probe went on talking to the ORIGINAL broken server. The restart was
# announced, the log said `restart 1/1`, and it changed nothing — a control
# that reports success while doing nothing at all. Caught by the canary below,
# which is the only reason it is not in CI right now.
kill_port() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${PORT}" 2>/dev/null | xargs -r kill -9 2>/dev/null
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" >/dev/null 2>&1
  fi
  if command -v netstat >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; then
    # Git Bash / Windows: no lsof, no fuser.
    #
    # `tr -d` of the carriage return is load-bearing. Windows netstat emits
    # CRLF, so the PID field arrives as "1234<CR>", taskkill rejects it, and the
    # kill reports nothing while freeing nothing — a teardown that looks like it
    # ran. The direct kill_port canary caught it; no end-to-end case did.
    netstat -ano 2>/dev/null | tr -d '\r' \
      | awk -v p=":${PORT}$" '$2 ~ p && /LISTENING/ {print $NF}' \
      | sort -u | while read -r pid; do
          [ -n "$pid" ] && taskkill //F //PID "$pid" >/dev/null 2>&1
        done
  fi
}

stop_server() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null
  kill_port
  # VERIFY, do not assume. A restart onto a held port is worse than no restart:
  # the new process dies and every later probe reads the old one's answers.
  for _ in $(seq 1 10); do
    port_held || return 0
    sleep 1
    kill_port
  done
  echo "::error::port $PORT is still held after kill — refusing to restart onto it, because the new server would die with EADDRINUSE and every probe after that would be answering from the old one"
  return 1
}

# Returns: 0 serving · 1 not listening yet · 2 listening but wrong
probe() {
  local code rc=0
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 30 "$URL") || rc=$?
  LAST_CODE="$code"
  LAST_RC="$rc"
  if [ "$rc" -ne 0 ] || [ "$code" = "000" ]; then return 1; fi
  if [ "$code" = "200" ]; then return 0; fi
  return 2
}

# Sourceable for tests: define the functions, run nothing. The teardown is the
# part with no honest mutation on Windows (the OS reaps process trees), so the
# canary calls kill_port DIRECTLY against a listener this script never started.
if [ "${WFDS_LIB:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

if [ -z "${START_CMD:-}" ]; then
  echo "::error::wait-for-dev-server: START_CMD is required" >&2
  exit 2
fi

attempt=0
while :; do
  if [ "$attempt" -eq 0 ]; then
    echo "starting dev server..."
  else
    echo "::warning::restart $attempt/$MAX_RESTARTS — $RESTART_REASON"
    if ! stop_server; then exit 1; fi
    if [ -n "$CLEAR_DIR" ] && [ -d "$WORK_DIR/$CLEAR_DIR" ]; then
      # Only on a restart. The first attempt deliberately reuses whatever the
      # build step left, so a healthy run pays no rebuild cost.
      echo "  clearing $WORK_DIR/$CLEAR_DIR before restart"
      rm -rf "${WORK_DIR:?}/${CLEAR_DIR:?}"
    fi
  fi
  start_server

  waited=0
  listening=0
  verdict=""
  while :; do
    probe; state=$?
    if [ "$state" -eq 0 ]; then verdict="serving"; break; fi

    if [ "$state" -eq 2 ]; then
      # Listening and answering the wrong thing. Allow a short grace window —
      # a genuinely cold route can 404 for a moment on some versions — but do
      # NOT spend the full listen budget here. The replies get FASTER as the
      # bad resolution caches, which is the opposite of a compile in progress.
      if [ "$listening" -eq 0 ]; then listening=1; served_at=$waited; fi
      if [ $((waited - served_at)) -ge "$SERVE_WAIT" ]; then
        verdict="latched"; break
      fi
    else
      listening=0
    fi

    if [ "$waited" -ge "$LISTEN_WAIT" ]; then verdict="silent"; break; fi
    sleep 2
    waited=$((waited + 2))
  done

  if [ "$verdict" = "serving" ]; then
    echo "dev server serving after ${waited}s (HTTP $LAST_CODE)"
    exit 0
  fi

  if [ "$verdict" = "latched" ]; then
    RESTART_REASON="server is LISTENING but $HEALTH_PATH returned $LAST_CODE for ${SERVE_WAIT}s — a route that exists resolved to not-found and the resolution is cached, so waiting cannot clear it"
  else
    RESTART_REASON="port $PORT never accepted a connection within ${LISTEN_WAIT}s"
  fi

  if [ "$attempt" -ge "$MAX_RESTARTS" ]; then
    echo "::error::dev server never became healthy: $RESTART_REASON"
    echo "--- $LOG_FILE tail ---"
    tail -40 "$LOG_FILE" 2>/dev/null || true
    stop_server
    exit 1
  fi
  attempt=$((attempt + 1))
done
