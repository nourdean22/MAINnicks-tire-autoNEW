#!/usr/bin/env bash
# Pre-push preflight for nickstire: the CI gates that turned PRs red, run
# locally in a few minutes, so the first push is the only push.
#
# Usage (from anywhere in the repo):
#   bash apps/nickstire/scripts/preflight.sh            # diff against origin/main
#   BASE=<sha> bash apps/nickstire/scripts/preflight.sh # a hook-free clone's origin can be stale; pass GitHub main's sha
#   SKIP_BUILD=1 bash apps/nickstire/scripts/preflight.sh
# Commit first: the DoD compiler step reads committed history (the other steps also see uncommitted and untracked files).
#
# Why each step is here (2026-10-09/10: 29 CI pushes for 14 PRs, most extra
# pushes were one of these):
#   tsc                      typecheck
#   lint:orphans             knip orphan gate: a test-only export needs a reasoned baseline entry
#   lint:source/sql/...      the node job's lint steps
#   repo-scan gate tests     fabricated-admin-read, fail-open slice, proc census, cron cadence:
#                            they scan the whole server tree, so running only "my" test files misses them
#   vitest related           every test that imports a changed file (a pinned budget in another
#                            file's canary went red this way)
#   ledger + DoD compiler    the completion-authority job
# Not covered: unresolved review threads (check-review-gate needs the PR) and the build of the
# other app. CI stays the authority; this only stops the avoidable reds.

set -uo pipefail
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$APP/../.." && pwd)"
BASE="${BASE:-origin/main}"
cd "$APP"

FAILED=()
step() {
  local name="$1"; shift
  local log; log="$(mktemp)"
  local t0=$SECONDS
  if "$@" >"$log" 2>&1; then
    echo "  ok    $name ($((SECONDS - t0))s)"
    grep '^note:' "$log" | sed 's/^/        /'
  else
    echo "  FAIL  $name ($((SECONDS - t0))s)"
    sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -vE '^\s*$' | tail -25 | sed 's/^/        /'
    FAILED+=("$name")
  fi
  rm -f "$log"
}

MB="$(git merge-base HEAD "$BASE" 2>/dev/null)" || { echo "preflight: cannot resolve base '$BASE'"; exit 2; }
# Committed and uncommitted changes since the base, plus new files not yet added (a new test file counts).
mapfile -t CHANGED < <({ git diff --name-only --diff-filter=d "$MB" -- . | sed 's#^apps/nickstire/##'; git ls-files --others --exclude-standard -- .; } | grep -E '\.(ts|tsx|mts)$' | sort -u || true)
echo "preflight: base $(git rev-parse --short "$MB"), ${#CHANGED[@]} changed ts files under apps/nickstire"

VITEST="node node_modules/vitest/vitest.mjs"

step "tsc"                pnpm run -s check
step "lint:source"        pnpm run -s lint:source
step "lint:sql"           pnpm run -s lint:sql
step "lint:hooks"         pnpm run -s lint:hooks
step "lint:pii"           pnpm run -s lint:pii
step "lint:cron-wiring"   pnpm run -s lint:cron-wiring
step "lint:curdate"       pnpm run -s lint:curdate
step "lint:orphans"       pnpm run -s lint:orphans
step "repo-scan gate tests" $VITEST run \
  server/fabricatedAdminReadGate.test.ts server/failOpenSliceGate.test.ts \
  server/__tests__/proc-census.test.ts server/__tests__/cron-cadence.test.ts \
  server/__tests__/scriptsDirectoryParity.test.ts server/__tests__/tableWriterCoverage.test.ts \
  server/__tests__/rawSqlTablesExist.test.ts server/__tests__/migration-journal.test.ts \
  server/__tests__/retired-llm-models.test.ts
# A file that fails in the shared run is rerun ALONE: green alone means machine
# load (sibling sessions share this machine) or file order, which the author did
# not cause and CI's full run decides; it is reported as a note, not a red.
# Witnessed 2026-10-10: candidatesSilentLoss timed out in every shared run, before
# and after the change under test, and passed 11/11 alone in 6 s.
related_tests() {
  local log; log="$(mktemp)"
  if $VITEST related --run --retry 1 "${CHANGED[@]}" >"$log" 2>&1; then rm -f "$log"; return 0; fi
  local failed
  mapfile -t failed < <(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -oE '^ FAIL  [^ ]+[.]test[.]tsx?' | awk '{print $2}' | sort -u)
  if [ "${#failed[@]}" -gt 0 ] && $VITEST run "${failed[@]}" >/dev/null 2>&1; then
    echo "note: red only in the shared run, green alone: ${failed[*]}"
    rm -f "$log"; return 0
  fi
  cat "$log"; rm -f "$log"; return 1
}
if [ "${#CHANGED[@]}" -gt 0 ]; then
  step "vitest related (changed files)" related_tests
fi
step "capability ledger"  node scripts/check-capability-ledger.mjs
step "DoD compiler"       bash -c "cd '$ROOT' && node apps/nickstire/scripts/dod-compiler.mjs --base '$MB' --enforce"
[ -z "${SKIP_BUILD:-}" ] && step "build" pnpm run -s build

echo
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "preflight: ${#FAILED[@]} red: ${FAILED[*]}. Fix before pushing; every push bills a full CI run."
  exit 1
fi
echo "preflight: all green. One push."
