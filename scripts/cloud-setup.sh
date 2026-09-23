#!/usr/bin/env bash
# cloud-setup — bootstrap a Claude Code cloud container for this monorepo.
#
# Point the cloud environment's SETUP SCRIPT at this file (Settings -> Cloud
# environments). It is idempotent: safe to re-run on every container start.
#
#   bash scripts/cloud-setup.sh
#
# It installs TOOLING ONLY and never writes a secret. Credentials come from the
# environment's own variables (see docs/CLOUD-ENVIRONMENT.md); this script only
# reports whether they arrived.
set -uo pipefail

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok()  { printf '   ok   %s\n' "$1"; }
bad() { printf '   MISS %s\n' "$1"; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 1
say "cloud-setup · $ROOT"

# ── pnpm, at the version package.json pins ───────────────────────────────
WANT_PNPM="$(node -p "(require('./package.json').packageManager||'pnpm@10').split('@')[1].split('+')[0]" 2>/dev/null || echo 10)"
if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm --version) present"
else
  say "installing pnpm $WANT_PNPM"
  corepack enable 2>/dev/null || true
  corepack prepare "pnpm@${WANT_PNPM}" --activate 2>/dev/null || npm i -g "pnpm@${WANT_PNPM}"
  command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm --version)" || bad "pnpm still unavailable"
fi

# ── Railway CLI — the gateway to BOTH databases ──────────────────────────
# Neither app keeps a .env in a cloud container. Both reach their database the
# same way: `railway run -s <service> -- <cmd>` injects that service's variables
# into one subprocess. nickstire -> TiDB, statenour-web -> Neon.
if command -v railway >/dev/null 2>&1; then
  ok "railway $(railway --version 2>/dev/null | head -1) present"
else
  say "installing the Railway CLI"
  npm i -g @railway/cli >/dev/null 2>&1
  command -v railway >/dev/null 2>&1 && ok "railway $(railway --version 2>/dev/null | head -1)" || bad "railway install failed"
fi

# ── workspace deps ───────────────────────────────────────────────────────
# A cloud container is NOT a junctioned worktree, so a real install is correct
# here — the opposite of the rule that applies on the operator's Windows box.
if [ -d node_modules ] && [ -d apps/nickstire/node_modules ]; then
  ok "workspace already installed"
else
  say "installing workspace dependencies (frozen lockfile)"
  pnpm install --frozen-lockfile || bad "workspace install failed"
fi

# ── credentials: report, never write ─────────────────────────────────────
say "credentials (set these in the cloud environment, not here)"
if [ -n "${RAILWAY_TOKEN:-}" ]; then ok "RAILWAY_TOKEN present (project-scoped)"
elif [ -n "${RAILWAY_API_TOKEN:-}" ]; then ok "RAILWAY_API_TOKEN present (account-scoped — prefer a project token)"
else bad "no Railway token — every production read and both databases are unreachable"; fi
[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ] && ok "GitHub token present" || bad "no GH_TOKEN — gh needs auth to open or merge a PR"

# ── verdict ──────────────────────────────────────────────────────────────
say "readiness"
node scripts/cloud-doctor.mjs || true
printf '\nSetup finished. Anything still MISSING above is configuration, not code —\nsee docs/CLOUD-ENVIRONMENT.md for exactly where each value goes.\n'
