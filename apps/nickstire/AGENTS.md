# AGENTS.md · nickstire

> **Read first:** [`truth_os.md`](./truth_os.md) — what is actually live in prod, updated on every
> ship. Then [`PROTECTED-CORE.md`](./PROTECTED-CORE.md) — the explicit no-touch file list; open it
> before editing anything under `server/`.
>
> **Cross-cutting rules** (branching, worktrees, protected operations, the enforcement map, Windows):
> root [`AGENTS.md`](../../AGENTS.md). This file adds only what is true of *this app*.

Cap: **200 lines**, enforced by `pnpm agent:parity`. **No prod facts here** — model names, flag values and versions go stale in a
policy file. They belong in `truth_os.md`, which is the thing agents are told to trust.

## 1 · Stack and shape

Nick's Tire & Auto — deploys to **nickstire.org** via Railway from `main`.

- **Client:** Vite 7 + React 19 + TypeScript + Tailwind 4 — an installed iOS PWA, not a browser tab
- **Server:** Express 4 + tRPC 11 · **DB:** Drizzle ORM -> MySQL (TiDB Cloud)
- **External:** VAPI (voice) · Twilio (SMS) · Stripe · Railway (Nixpacks) · pnpm 10 · Node 24 · Vitest

Work lands in four places: `client/src/pages/admin/` (admin UI) · `server/routers|services|cron/` ·
`shared/` (cross-boundary types + `routes.ts`) · `drizzle/schema.ts` (**DB source of truth**).

**Adding an admin section: edit the registry, not four copies.**
`client/src/pages/admin/registry.tsx` has been the single source of truth for sidebar shape,
grouping, ordering and role access since 2026-08-03, and two tests enforce it
(`adminRegistryTruth.test.ts`, `admin-registry-integrity.test.ts`). Note the two distinct `shared/`
directories: app-level `apps/nickstire/shared/` (`types.ts`, `routes.ts`) and admin-level
`client/src/pages/admin/shared/` (`nav.tsx`, `constants.tsx`, `types.ts`). Adding a route means
registering it in app-level `shared/routes.ts` — `validate:routes` fails otherwise.

> **Superseded instruction, recorded so it cannot come back.** This file used to say a new admin
> section "requires updating all four files in `shared/`" — `types.ts`, `nav.tsx`, `constants.tsx`,
> `Admin.tsx` — and pointed three of them at a directory they do not live in. Those are precisely the
> four drifted copies the 2026-08-03 registry unification deleted; `adminRegistryTruth.test.ts` opens
> by naming them. Following the old rule recreates duplication a test now forbids.

## 2 · Commands

pnpm 10 only — never npm, never yarn.

| Task | Command (from `apps/nickstire/`) |
|---|---|
| **Master verify gate** | `pnpm run verify` |
| Typecheck | `pnpm run check` |
| Dev server | `pnpm dev` |
| One test file | `pnpm exec vitest run <path>` |
| Full suite | `pnpm exec vitest run` |

`pnpm run verify` chains, in order: `env:validate` · `typecheck:raw` · `lint` · `lint:source` ·
`lint:sql` · `lint:hooks` · `lint:brand-voice` · `lint:pii` · `validate:routes` · `prerender:check` ·
`prerender:semantic-check` · `migrations:check` · `test` · `build`. Name the failing link when you
report a red, not "verify failed".

> **Serial is the DEFAULT now — do not pass pool flags by hand.** `vitest.config.ts` sets
> `pool: "forks"` + `poolOptions.forks.singleFork: true`, so `vitest run`, `pnpm run test` and
> `pnpm run verify` are all serial. Any doc or habit that still recites
> `--pool=forks --poolOptions.forks.singleFork=true` is stale — the flags are redundant, not wrong.
>
> This was a real defect until 2026-08-21: #515 ("deterministic serial vitest") added the comment
> and the `unstubEnvs`/`unstubGlobals` safety nets but **never set `pool`**, so the gate ran
> parallel for months while this file instructed serial. Measured back-to-back on one commit:
> **parallel → 5,851 passed, 1 FAILED, exit 1, 186.87s** (the `instagramStudio` render smoke timed
> out at 60s under concurrent load) · **serial → 5,858 passed, 0 failed, exit 0, 81.11s.** Serial is
> both correct *and* 2.3× faster here; parallelism was buying contention, not speed.

> **Typecheck blind spot.** `scripts/` sits outside the typecheck project, so a broken import in a
> script passes every gate and fails only at runtime. Run the scripts you change.

## 3 · Test hygiene — serial mode shares one process

Serial mode shares ONE process across ALL test files: one `globalThis`, one `process.env`, one
`vi.mock` registry, one jsdom document. Leaks surface as order-dependent "intermittent" failures in
*unrelated* files (purged repo-wide in #515/#517). Every rule below cost a real afternoon:

- Needs a REAL shared module (db, drizzle schema/orm, mysql2, sms, email-notify)? Hoist
  `vi.unmock("<specifier>")` at the top — pattern precedent: `server/routers/voiceAgent.test.ts`.
- Never leave an unused or partial `vi.mock` factory in a file — a dead partial db mock in
  `winback.test.ts` was the original flake source, and it failed files that never imported it.
- `vi.stubGlobal` / direct `global.fetch =` → restore in `afterEach` via `vi.unstubAllGlobals()`.
  `vi.doMock` → matching `vi.doUnmock` in `afterEach` (**doMocks are NOT file-scoped here**). The
  config-level `unstubGlobals`/`unstubEnvs` flags are a safety net, not a licence to skip per-file
  cleanup.
- `process.env.X = ...` must be **restored or deleted** in `afterEach`/`afterAll`. Two foot-guns:
  `if (orig) env.X = orig` leaks when `orig` was `undefined`; `env.X = undefined` stores the literal
  string `"undefined"`.
- Cleanup inside a test body must be `try/finally` — a failed assertion skips trailing cleanup lines
  (fake timers, env deletes).
- RTL renders are auto-unmounted by the `afterEach(cleanup)` in `client/src/__tests__/setup.ts`
  (RTL auto-cleanup can't self-register because `globals: true` is off) — don't remove it.
- Prove order-independence before shipping test changes:
  `pnpm exec vitest run --sequence.shuffle.files --sequence.seed=N` forces a deterministic file
  order; sweep a few seeds.

<!--
  2026-08-21: these eight bullets were briefly cut from this file with a note claiming the full set
  "lives in the nickstire-verify skill". IT DOES NOT — grep that SKILL.md for unmock / doUnmock /
  try-finally / shuffle / unstubAllGlobals / voiceAgent and every count is 0; its description covers
  the verify sequence, the brand-voice false positive and the prerender regen rule only. A false
  "it was relocated" note is worse than leaving bloat: the fact is gone AND nobody goes looking.
  Restored here. If they should live in the skill, WRITE them there first, then cut.
-->


## 4 · Branching and CI

Root [`AGENTS.md`](../../AGENTS.md) → Branching owns the rules (named branch, PR, squash-merge,
explicit paths, never `main`). App-specific facts only:

- Branch prefix is `nickstire/<task>`. PRs are squash-merged — never stack on another open PR.
- Pre-push gate is repo-root `lefthook.yml` → `pnpm run build:affected`.
- Review routing, **not** enforcement: `.github/CODEOWNERS` lists `drizzle/` and `server/` under
  `@nourdean22`. It becomes *required* only if branch protection enables "Require review from Code
  Owners" — an operator-side repo setting that is currently OFF.
- PR final report: `Branch · SHA · changed files · checks run (with receipts) · intentional exclusions`.

## 5 · Standing rules — the ones no tool checks

Anything `pnpm run verify` already catches is in the §2 chain above, not repeated here. These are the
unenforced ones.

### PII — the gate catches shapes, not judgement
`lint:pii` (in `pnpm run verify`) scans for phones, emails, full names, VINs, addresses, card numbers,
SSN and DL. What it CANNOT check, and is therefore on you:
- **Confirm it actually scanned your staged files** — a scan that matched nothing and a scan that ran
  on nothing print the same green.
- Customer names, phones, emails, addresses, invoice IDs and service histories all require
  minimization. The public shop phone/address may be allowlisted, but only deliberately.
- Prefer anonymized test data, and **keep PII out of logs** — the linter never reads your log output.

### Time — Cleveland/Eastern, explicitly
The shop runs on `America/New_York`. Every SMS sending window, daily metric and "today" calculation
converts explicitly — never the DB or server default timezone, never a bare `CURDATE()`. Mock time
with Vitest fake timers whenever a sending window or day boundary is under test, and handle DST in
both the design and the test. Driver-parsed TiDB `DATETIME` values come back shifted on ET, so
compute ages and day-buckets **in SQL**, not in JS.

### Database
- Migrations are **hand-applied SQL** in `drizzle/*.sql` — no auto-migrate, and never run one without
  explicit operator approval. `drizzle/schema.ts` is the source of truth; don't edit generated files.
- TiDB is MySQL-compatible, **not** Postgres: no `RETURNING`, no `ON CONFLICT DO UPDATE`. Drizzle's
  MySQL dialect handles this; raw SQL must be MySQL-safe. Column, index and status changes have
  TiDB-only failure modes, one of which loses the row silently — Claude skill: `nickstire-tidb-ddl`.

### Content and claim safety
`lint:brand-voice` blocks the obvious violations but cannot see intent:
- No invented warranties, wait-times or reviews. No "guaranteed", no fabricated timelines.
- "Payment Programs", never "financing".
- **Used-tire pricing is deliberately two-tier**: web says "from $25 installed (select 12-inch; most
  $40–80)", quoting channels say $60. Do NOT "fix" either direction — both are intentional.

### External side effects — owner-gated
Live GBP/Instagram/Facebook posts, review replies, SMS or email sends, Stripe/refund calls, supplier
orders: never execute without explicit operator approval in a dedicated PR. Build
preview/draft/copy-only; kill-switches flip only in approved PRs. The SMS trigger is `activate()`,
not a flag.

### Prerendering
Never hand-edit `prerendered/` — run `pnpm run prerender` (currently broken on Windows; CI
regenerates). `prerender:check` and `prerender:semantic-check` gate it.

## 6 · Gotchas that have actually cost time

- **Lockfile:** after any `package.json` dep change, regenerate and commit `pnpm-lock.yaml` — Railway
  CI rejects stale lockfiles.
- **SMS/VAPI live in `server/`.** The client triggers via tRPC; never call Twilio or VAPI from the
  browser.
- **`lint:brand-voice` is a hard gate, not a warning** — a claim-safety violation blocks `verify`.
  That is intentional; do not route around it.
- **iOS PWA:** `window.alert/confirm/prompt` in `client/src` is blocked by `lint:source`. Use in-DOM
  two-tap confirms and 48x48px minimum touch targets.
