#!/bin/bash
# Pre-push build gate — prevents pushing code that fails local quality checks.
# Protects against the class of bugs that caused 11 consecutive deploy failures
# (missing deps, tsconfig issues, client/server import leaks, hook violations).
#
# Speed tiers:
#   codex/ollama-local        : typecheck + lint + test  (~10-20s)
#   statenour-master          : full production build    (~60-120s)
#   any other branch          : typecheck + lint + test  (~10-20s)
#
# Install: bash scripts/install-hooks.sh   (installs as a shim, no copy)
# Skip once: GIT_PUSH_SKIP_HOOK=1 git push
# Run manually: bash scripts/pre-push-check.sh
#
# v10.0.182 · DO NOT cp this file into .git/hooks/pre-push directly.
# That created drift — v10.0.181's Venice disable_thinking gate didn't
# run on its ship push because the installed copy was stale.
# install-hooks.sh installs a thin shim that always execs THIS file
# at push time, so script edits take effect immediately.

set -e

if [ "${GIT_PUSH_SKIP_HOOK:-0}" = "1" ]; then
  echo "⚠️  pre-push hook skipped (GIT_PUSH_SKIP_HOOK=1)"
  exit 0
fi

# Bump Node heap — statenour-os is large enough that ESLint OOM's at
# the default 4GB limit on lint passes that touch every file. 8GB keeps
# headroom on 16/32GB dev machines and is harmless on CI.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=8192"

# Detect branch (works whether hook receives refs on stdin or via git)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo ""
echo "🔍  pre-push · branch: $BRANCH"
echo ""

echo "  [1/15]  typecheck ..."
pnpm exec tsc --noEmit >/tmp/statenour-typecheck.log 2>&1
if [ $? -ne 0 ]; then
  echo "  ❌  TypeScript errors:"
  grep "error TS" /tmp/statenour-typecheck.log | head -10
  echo ""
  echo "  push rejected. fix above errors, try again."
  exit 1
fi
echo "  ✅  typecheck clean"

# v10.0.159 · prisma schema format gate. CI's schema-drift guard
# runs `prisma format` and sha256-compares the schema before/after —
# if they differ, the schema is mis-aligned. v10.0.158 was a CI
# failure of exactly this kind. Mirror the check locally so it
# never lands on remote with bad alignment again.
#
# Behavior: backup schema → run format → compare hashes. On diff,
# leave the formatted version in place (it's correct) + tell the
# operator to amend the commit. We don't auto-amend — that'd be
# surprising; the operator should see the diff before re-pushing.
echo "  [2/15]  prisma schema format ..."
SCHEMA_PATH="prisma/schema.prisma"
if [ ! -f "$SCHEMA_PATH" ]; then
  echo "  ⚠️   $SCHEMA_PATH not found · skipping format gate"
else
  BEFORE_HASH=$(sha256sum "$SCHEMA_PATH" | awk '{print $1}')
  pnpm exec prisma format --schema "$SCHEMA_PATH" >/tmp/prisma-format.log 2>&1 || {
    echo "  ❌  prisma format failed:"
    cat /tmp/prisma-format.log | tail -10
    exit 1
  }
  AFTER_HASH=$(sha256sum "$SCHEMA_PATH" | awk '{print $1}')
  if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
    echo "  ❌  schema.prisma was not formatted before commit."
    echo "      ran 'prisma format' for you — review the diff and amend:"
    echo ""
    echo "        git add prisma/schema.prisma"
    echo "        git commit --amend --no-edit"
    echo "        git push"
    echo ""
    echo "      this matches the CI schema-drift guard's check exactly."
    exit 1
  fi
  echo "  ✅  schema.prisma formatted correctly"
fi

echo "  [3/15]  lint ..."
pnpm exec eslint . >/tmp/statenour-lint.log 2>&1 || true
ERR_COUNT=$(grep -c "error" /tmp/statenour-lint.log 2>/dev/null || echo 0)
# Tolerate warnings; fail only on actual errors (react-hooks, etc).
if pnpm exec eslint . --quiet >/dev/null 2>&1; then
  echo "  ✅  lint clean (warnings allowed)"
else
  echo "  ❌  ESLint errors found (quiet mode):"
  pnpm exec eslint . --quiet 2>&1 | tail -20
  echo ""
  echo "  push rejected."
  exit 1
fi

echo "  [4/15]  tests ..."
pnpm exec vitest run >/tmp/statenour-tests.log 2>&1
if [ $? -ne 0 ]; then
  echo "  ❌  tests failing:"
  tail -20 /tmp/statenour-tests.log
  exit 1
fi
TEST_COUNT=$(grep -oE "[0-9]+ passed" /tmp/statenour-tests.log | head -1 || echo "?")
echo "  ✅  tests pass ($TEST_COUNT)"

echo "  [5/15]  raw-sql column audit ..."
pnpm exec tsx scripts/audit-raw-sql-columns.ts >/tmp/statenour-sqlaudit.log 2>&1
if [ $? -ne 0 ]; then
  echo "  ❌  raw-SQL unsafe column reference:"
  tail -30 /tmp/statenour-sqlaudit.log
  echo ""
  echo "  fix: wrap camelCase columns in double quotes, e.g. WHERE \"createdAt\" >= \$1"
  exit 1
fi
echo "  ✅  raw-sql columns safe"

# Cron-manifest drift guard. CI fails the push if config/crons.ts +
# vercel.json + the routes on disk drift apart. Catches dark code
# (route files that exist but aren't registered) and stale vercel.json
# entries. Bit us once on commit 6c41037 — never again.
#
# v8.8 — also enforces the Vercel Pro 40-cron-budget. fails the push
# if active crons > 38 (leaves a 2-slot safety margin). Bit us when
# v8.7 pushed past 50 actives — never again.
echo "  [6/15]  cron manifest drift + budget ..."
pnpm exec tsx scripts/verify-crons.ts >/tmp/statenour-crons.log 2>&1
if [ $? -ne 0 ]; then
  echo "  ❌  cron manifest drift detected:"
  tail -30 /tmp/statenour-crons.log
  echo ""
  echo "  fix: add the dark-code routes to config/crons.ts, then run"
  echo "       'pnpm check:crons --fix' to resync vercel.json."
  exit 1
fi
# Budget check — count active schedules.
ACTIVE_CRONS=$(pnpm exec tsx --eval "import { CRONS } from './config/crons'; console.log(CRONS.filter(c => c.mode === 'active' && c.schedule).length)" 2>/dev/null | tail -1)
if [ -z "$ACTIVE_CRONS" ]; then ACTIVE_CRONS=0; fi
if [ "$ACTIVE_CRONS" -gt 38 ]; then
  echo "  ❌  cron budget exceeded: $ACTIVE_CRONS active (Vercel Pro cap = 40, soft cap = 38)"
  echo ""
  echo "  fix: fold low-cadence crons into mega-morning/mega-evening,"
  echo "       or retire superseded crons. See v8.7.1/v8.7.2 commits"
  echo "       for the pattern."
  exit 1
fi
REM=$((40 - ACTIVE_CRONS))
if [ "$ACTIVE_CRONS" -gt 36 ]; then
  echo "  ⚠️   cron budget WARNING: $ACTIVE_CRONS active ($REM slot(s) until cap)"
  echo "      consider folding more crons before adding new ones."
fi
echo "  ✅  cron manifest in sync ($ACTIVE_CRONS active, $REM slot(s) headroom under 40-cap)"

# AI tool-catalog contract. CI runs this as a separate step (named
# "Tool catalog contract" in the GHA UI) so adding it here keeps
# pre-push and CI symmetrical — any future ai-only check that lands
# in CI will be caught locally without us noticing the asymmetry.
echo "  [7/15]  AI tool-catalog contract ..."
pnpm exec vitest run tests/ai/ >/tmp/statenour-ai-tests.log 2>&1
if [ $? -ne 0 ]; then
  echo "  ❌  AI contract tests failing:"
  tail -20 /tmp/statenour-ai-tests.log
  exit 1
fi
echo "  ✅  AI contract tests pass"

# v8.21 · Secret-bypass guard. Reject patterns where a known-secret env
# var is silently defaulted to empty string, which makes auth checks
# vacuously pass when the env var isn't configured (the C2 class of
# regression: missing env var → silent auth-disable).
echo "  [8/15]  env-secret bypass guard ..."
# v9.1.14 · expanded SECRET_VARS: STATENOUR_SYNC_KEY (the v9.1.13
# code-review surfaced its silent fallthrough in /api/webhooks/nickstire),
# MAKE_WEBHOOK_SECRET (was already gated correctly but should be tracked
# defensively).
SECRET_VARS="TELEGRAM_WEBHOOK_SECRET|CRON_SECRET|SYNC_SECRET|ADMIN_PASSWORD|WEBHOOK_SECRET|STATENOUR_SYNC_KEY|MAKE_WEBHOOK_SECRET"
# Find offenders: process.env.<SECRET> ?? "" or process.env.<SECRET> || ""
# v9.1.14 · also catches bracket-notation: process.env["NAME"] || ""
OFFENDERS=$(grep -rEn "process\\.env\\.($SECRET_VARS)\\s*(\\?\\?|\\|\\|)\\s*\"\"" \
  --include="*.ts" --include="*.tsx" \
  app/ lib/ scripts/ 2>/dev/null || true)
OFFENDERS_BRACKET=$(grep -rEn "process\\.env\\[\"($SECRET_VARS)\"\\]\\s*(\\?\\?|\\|\\|)\\s*\"\"" \
  --include="*.ts" --include="*.tsx" \
  app/ lib/ scripts/ 2>/dev/null || true)
OFFENDERS=$(printf "%s\n%s" "$OFFENDERS" "$OFFENDERS_BRACKET" | grep -v "^$" || true)
if [ -n "$OFFENDERS" ]; then
  echo "  ❌  secret env var defaulting to empty string (silent-bypass risk):"
  echo "$OFFENDERS" | head -10
  echo ""
  echo "  fix: throw at module load if the env var is missing — never let"
  echo "       a missing secret silently disable auth. See"
  echo "       app/api/telegram/webhook/route.ts for the v8.21 pattern."
  exit 1
fi
echo "  ✅  no env-secret silent-bypass patterns"

# v8.21 · Auth coverage gate. Every API route mutating data should have
# either an apiHandler() wrapper, a requireSession/requireCronAuth call,
# or an explicit "// public:" comment justifying the omission.
#
# v8.26 · Hard mode by default. The 51 legacy routes flagged at gate
# introduction were retrofitted with `requireSession(req)` via
# scripts/add-route-auth.ts. From here on the gate fails-closed; set
# AUTH_GATE_SOFT=1 in an emergency to demote it to a warning.
echo "  [9/15]  API route auth coverage ..."
# Recognized auth patterns:
#   - apiHandler / cronHandler / syncHandler from lib/utils/http (default
#     auth: cron/sync; apiHandler defaults to session-gated access).
#   - Direct calls to requireSession / requireCronAuth / requireSyncAuth.
#   - assertRunnerRequest from lib/internal/runner-auth (HMAC + nonce).
#   - Inline header-secret check via EXPECTED_SECRET / SYNC_KEY constants
#     (legacy webhook pattern; pairs with v8.21 env-secret bypass guard).
#   - Explicit "// public: <reason>" annotation = intentional, audited.
AUTH_PATTERNS="apiHandler|cronHandler|syncHandler|requireSession|requireCronAuth|requireSyncAuth|assertRunnerRequest|EXPECTED_SECRET|SYNC_KEY|// public:"
UNAUTHED=""
UNAUTHED_COUNT=0
for f in $(find app/api -name "route.ts" -type f 2>/dev/null); do
  if ! grep -qE "^export (async )?(function|const) (POST|PATCH|PUT|DELETE)" "$f"; then
    continue
  fi
  if grep -qE "$AUTH_PATTERNS" "$f"; then
    continue
  fi
  UNAUTHED="$UNAUTHED\n  $f"
  UNAUTHED_COUNT=$((UNAUTHED_COUNT + 1))
done
if [ -n "$UNAUTHED" ]; then
  if [ "${AUTH_GATE_SOFT:-0}" = "1" ]; then
    echo "  ⚠️   $UNAUTHED_COUNT routes missing recognized auth pattern (soft mode)"
  else
    echo -e "  ❌  $UNAUTHED_COUNT routes with mutating methods + no recognized auth pattern:$UNAUTHED"
    echo ""
    echo "  fix: wrap with apiHandler({ auth: 'owner' }) OR call requireSession(req)"
    echo "       at the top OR add '// public: <reason>' comment if intentional."
    echo "  emergency override: AUTH_GATE_SOFT=1 to demote to warning."
    exit 1
  fi
else
  echo "  ✅  all mutating API routes have auth coverage"
fi

# v9.1.14 · Sensitive GET-route auth gate. Read-only data exfiltration
# was the blind spot of the v8.21 mutating-only gate. Routes under
# these paths return operator-private data and MUST have auth: "owner"
# (or an explicit "// public:" annotation) regardless of method.
echo "  [10/15]  sensitive GET-route auth coverage ..."
# v10.0.183 · TIGHTENED. Pre-fix this gate did a file-level grep for
# requireSession — which passed when auth was on POST/PATCH/DELETE
# but missing on GET. The new TS-based gate scopes the check to each
# GET handler's BODY. /api/ai/chat/[id] and 7 others were leaking
# this exact way; v10.0.183 fixed them and shipped this gate.
pnpm exec tsx scripts/check-sensitive-get-auth.ts || exit 1
# (Old bash gate removed in v10.0.183 — superseded by the TS-based
# handler-body scanner above. The bash version did file-level grep
# which silently passed when auth was on PATCH/DELETE but missing
# on GET — that exact gap let /api/ai/chat/[id] ship unauthed.)

# v10.0.148 · Policy coverage gate. Verifies every active/folded cron
# in config/crons.ts has a matching AutomationPolicy registry entry.
# Soft mode until 2026-05-10 (one-week soak after v10.0.148 ship);
# auto-ratchets to HARD after that. Override with POLICY_GATE_HARD=1
# / POLICY_GATE_SOFT=1.
echo "  [11/15]  AutomationPolicy registry coverage ..."
if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
fi
pnpm exec tsx scripts/check-policy-coverage.ts || exit 1

# v10.0.180 · Venice disable_thinking gate. The same bug class hit
# production THREE times in one day (v10.0.178/179/180): direct
# fetches to /v1/chat/completions where disable_thinking was unset,
# letting reasoning-capable models burn the output budget on
# internal <think> tokens and return empty visible content. The
# script greps every Venice consumer and forces the author to
# acknowledge the field. See script header for the full history.
echo "  [12/15]  Venice disable_thinking gate ..."
pnpm exec tsx scripts/check-venice-disable-thinking.ts || exit 1

# v10.0.197 · Anti-slop UI gate. /web-artifacts-builder + /frontend-
# design enumerate Inter font, Roboto/Arial defaults, and purple
# SaaS gradients as AI-slop signatures. Block them at push time so
# the design baseline (DFII 15 link-review spread) doesn't decay.
echo "  [13/15]  anti-slop UI gate ..."
bash scripts/check-anti-slop.sh || exit 1

echo "  [14/15]  destructive prisma push guard ..."
# v10.0.154 · destructive-push guard. v10.0.148+150 used
# `prisma db push --accept-data-loss` (in package.json's
# build:push-schema target) which silently dropped 7000+ pgvector
# embeddings + the FTS column managed via raw SQL. Catch the pattern
# at push time so a future contributor doesn't repeat it.
#
# Scope is intentionally narrow: only package.json scripts + GHA
# workflow files. Comments + docstrings + the read-only schema-drift
# checker (which uses --accept-data-loss in --dry-run-equivalent
# mode for diff detection) are NOT flagged.
DESTRUCTIVE=""
# package.json scripts block — anything between "scripts": { ... }
# that mentions --accept-data-loss is dangerous because npm run
# triggers actual writes.
if grep -qE "\"[a-z:-]+\":\s*\"[^\"]*--accept-data-loss" package.json; then
  DESTRUCTIVE=$(grep -nE "\"[a-z:-]+\":\s*\"[^\"]*--accept-data-loss" package.json)
fi
# GHA workflows that run prisma db push --accept-data-loss in CI.
if [ -d .github/workflows ]; then
  WF_HITS=$(grep -rnE "prisma db push.*--accept-data-loss" .github/workflows/ 2>/dev/null || true)
  if [ -n "$WF_HITS" ]; then
    DESTRUCTIVE="$DESTRUCTIVE
$WF_HITS"
  fi
fi
if [ -n "$DESTRUCTIVE" ]; then
  echo "  ❌  destructive prisma push pattern in shipping config:"
  echo "$DESTRUCTIVE"
  echo ""
  echo "  fix: drop --accept-data-loss. Use plain \`prisma db push\` so"
  echo "       the operator reviews data-loss prompts manually. Raw-SQL"
  echo "       columns (pgvector, tsvector) get nuked otherwise. See"
  echo "       scripts/recover-pgvector-from-text.ts for recovery."
  exit 1
fi
echo "  ✅  no --accept-data-loss patterns in package.json or CI"

# v10.0.213 · Full production build is now MANDATORY on every push,
# not just statenour-master. v10.0.208 shipped a `next build` failure
# (provider.ts dynamic import pulled prisma into a client bundle —
# Turbopack rejected with "Module not found: Can't resolve 'fs'") that
# this gate would have caught locally. Pre-fix the gate skipped build
# on codex/ollama-local pushes "to save 60-120s." That tradeoff was
# wrong: 60-120s of build time beats a broken production deploy + the
# ~45min recovery loop (CI fail email → debug → fix → repush → wait).
#
# The build target is `pnpm run build:check`, which alias to next build
# with dummy env (mirrors CI exactly). Set GIT_PUSH_SKIP_BUILD=1 in a
# genuine emergency to demote.
echo ""
echo "  [15/15]  full production build (mandatory) ..."
if [ "${GIT_PUSH_SKIP_BUILD:-0}" = "1" ]; then
  echo "  ⚠️   build gate skipped (GIT_PUSH_SKIP_BUILD=1) — your deploy may fail in CI"
else
  BUILD_T0=$(date +%s)
  pnpm run build:check >/tmp/statenour-build.log 2>&1
  if [ $? -ne 0 ]; then
    echo "  ❌  production build FAILED — would break Vercel deploy:"
    tail -40 /tmp/statenour-build.log
    echo ""
    echo "  fix the build error before pushing. Set GIT_PUSH_SKIP_BUILD=1"
    echo "  to bypass in a genuine emergency (CI will still fail the deploy)."
    exit 1
  fi
  BUILD_DUR=$(( $(date +%s) - BUILD_T0 ))
  echo "  ✅  build passed (${BUILD_DUR}s)"
fi

echo ""
echo "  🟢  pre-push gate passed · push proceeding"
echo ""
exit 0
