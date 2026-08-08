# Enforced Gates

These scripts are **codified standards**. If one exists, the rule it enforces is
not optional — read the script before arguing with it.

## Push gate

`lefthook.yml` `pre-push` → `pnpm run build:affected`. That is the only
blocking gate. Other printed checks (lint-baseline, prompt:size-check) can be
RED but are **non-blocking** — a green local test run is on you.

## Pre-commit (staged globs, parallel)

| Check | App |
|---|---|
| `lint:brand-voice` · `lint:source` · `lint:hooks` · `validate:routes` · `check` | nickstire |
| `typecheck` · `lint` · `scan-secrets --staged` | statenour |
| `node scripts/agent-os/verify.mjs` | when policy/instruction files staged |

Secret scanning is `--staged` on purpose: the whole-repo scanner rightly flags
local `.env` files, so it could never gate a dev machine. Staged-only scans
exactly what is about to enter history.

## statenour semantic checks (`pnpm check:*`)

`check:raw-sql` · `check:secrets` · `check:prompt-injection` ·
`check:soft-delete` · `check:mutations` (+ `:strict`) · `check:get-auth` ·
`check:anti-slop` · `check:policy-coverage` · `check:env` (+ `:prod`) ·
`check:stale-docs` · `check:runbooks` · `check:audit-deps` · `check:crons`

Each encodes a rule: raw SQL is restricted, soft-delete must be honored on
reads, mutations and auth must follow the sanctioned pattern, prompts are
injection-screened, docs must not go stale.

**The rules themselves — and the production incident behind each — are in
[`codified-rules.md`](./codified-rules.md). Read that before working around a
failing gate.**

## nickstire checks

`lint:source` · `lint:sql` · `lint:hooks` · `lint:brand-voice` · `lint:pii` ·
`validate:routes` · `migrations:reconcile` · `migrations:check`

PII linting and route validation are real gates — treat a failure as a defect,
not noise.

## Verify gates by app

- **statenour** (from `apps/statenour/`): `pnpm typecheck` · `pnpm lint` ·
  `pnpm test` · full gate `pnpm verify:hard`
- **nickstire** (from `apps/nickstire/`): `pnpm run verify` (master gate)
- **worker** (from `apps/worker/`): `pnpm check` + `pnpm build`. No test suite.
- **Agent policy**: `pnpm agent:verify`
- **Supply chain**: `powershell scripts/security-scan.ps1` (advisory;
  `-FailOnCritical` to gate) → `reports/security-audit.json`

## CI is advisory, not a gate

There is no branch protection, so `gh pr merge` succeeds over a red check.
**Red = stop, by convention.** Never disable a hook to unblock yourself.
