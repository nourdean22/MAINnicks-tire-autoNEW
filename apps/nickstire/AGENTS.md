# AGENTS.md · nickstire-dev

Full project context + operating directive: [`CLAUDE.md`](./CLAUDE.md). What's true in prod: [`truth_os.md`](./truth_os.md). Don't-touch list: [`PROTECTED-CORE.md`](./PROTECTED-CORE.md).

## Package Manager
Use **pnpm** (9+): `pnpm install`, `pnpm dev`, `pnpm run verify` (master gate).
Fresh git worktrees need `pnpm install --frozen-lockfile` first or the pre-push hook fails with "turbo not found".

## File-Scoped Commands
| Task | Command |
|------|---------|
| Typecheck (whole app — no per-file) | `pnpm run check` |
| Test one file | `pnpm exec vitest run path/to/file.test.ts --pool=forks --poolOptions.forks.singleFork=true` |
| Full suite (MUST be serial on Windows) | `pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true` |
| Route registry | `pnpm run validate:routes` |
| Brand voice / source / hooks | `pnpm run lint:brand-voice` · `lint:source` · `lint:hooks` |

Parallel vitest rotates 5s-timeout import flakes on this box — always pass the single-fork flags.

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: <model name> <noreply@anthropic.com>
```

## Key Conventions
- **NEVER push `main`** — named branches (`nickstire/<task>`) + PR; operator merges (repo rule 2026-06-11; see root `AGENTS.md`).
- **Stage only your files by explicit path** — never `git add -A` (concurrent agent sessions share `main`).
- **PRs are squash-merged** — never stack branches on another open PR's commits; if you must build ahead, expect a cherry-pick rebuild after the parent lands.
- **Migrations are hand-applied SQL** (`drizzle/*.sql`) — there is no auto-migrate; never run one without explicit approval.
- **Never hand-edit `prerendered/`** — run `pnpm run prerender` (currently broken on Windows; CI regenerates).
- **iOS PWA**: `window.confirm/alert/prompt` are silently suppressed — use in-DOM confirms (two-tap pattern).
- **Claim safety**: no invented warranties/wait-times/reviews, no "guaranteed", "Payment Programs" not "financing". Used-tire pricing is two-tier — WEB says "from $25 installed (select 12-inch; most $40-80)", quoting channels say $60. Do not "fix" either direction.
- **External side effects are owner-gated**: no live GBP/IG/FB posting, review replies, SMS/email sends, Stripe/refund calls, or supplier orders. Build preview/draft/copy-only; kill-switches flip only in dedicated approved PRs.
- New admin section = update all of: `shared/types.ts` (union) · `shared/nav.tsx` · `shared/constants.tsx` (SECTION_TITLES) · `Admin.tsx` (lazy import, render branch, TAB_ALIASES, VALID_SECTIONS).
- New route = register in `shared/routes.ts` or `validate:routes` fails.

## Layout (where work happens)
`server/routers/` tRPC · `server/services/` logic · `server/cron/` jobs · `client/src/pages/admin/` admin UI · `shared/` cross-imports · `drizzle/schema.ts` DB source of truth.
