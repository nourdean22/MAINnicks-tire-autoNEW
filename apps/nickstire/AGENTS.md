# AGENTS.md · nickstire-dev
**Last refreshed:** 2026-07-04 · singleFork test-hygiene rules (PRs #515/#517)

> **Read first:** [`CLAUDE.md`](./CLAUDE.md) — operator context, identity, core rules, mode detection. Then [`truth_os.md`](./truth_os.md) for what is live in prod. Then [`PROTECTED-CORE.md`](./PROTECTED-CORE.md) for the no-touch list.
>
> **Cross-cutting repo rules** (branching, shared main, Windows PowerShell, pnpm): root [`AGENTS.md`](../../AGENTS.md) + [`CIITTY v2.1`](../../.agents/frameworks/ciitty/SKILL.md).

---

## 1 · Where We Are

**App:** Nick's Tire & Auto — `apps/nickstire/` in the NOURCITY monorepo. Deploys to **nickstire.org** via Railway from `main`.

**Stack:**
- **Client:** Vite 7 + React 19 + TypeScript + Tailwind CSS 4 (PWA, iOS standalone)
- **Server:** Express 4 + tRPC 11
- **DB:** Drizzle ORM → MySQL (TiDB Cloud)
- **Auth/SMS/Voice:** VAPI · Twilio · Stripe
- **Infra:** Railway (Nixpacks) · pnpm 9+ · Node 20+ · Vitest

**Two companion apps share this monorepo:** `apps/statenour` (bdnick.info). Changes to `packages/` or `pnpm-lock.yaml` affect both.

---

## 2 · Repo Layout (Where Work Happens)

```
apps/nickstire/
├── client/
│   └── src/
│       └── pages/admin/   ← Admin UI (React pages)
├── server/
│   ├── routers/           ← tRPC routers (API surface)
│   ├── services/          ← Business logic
│   └── cron/              ← Scheduled jobs
├── shared/
│   ├── types.ts           ← Union types (add new section here)
│   ├── nav.tsx            ← Navigation (add new section here)
│   ├── constants.tsx      ← SECTION_TITLES (add new section here)
│   └── routes.ts          ← Route registry (validate:routes reads this)
├── drizzle/
│   └── schema.ts          ← DB source of truth
└── AGENTS.md              ← This file
```

**Adding a new admin section?** Update ALL of:
1. `shared/types.ts` (union)
2. `shared/nav.tsx`
3. `shared/constants.tsx` (SECTION_TITLES)
4. `Admin.tsx` (lazy import, render branch, TAB_ALIASES, VALID_SECTIONS)

**Adding a new route?** Register it in `shared/routes.ts` — `validate:routes` fails otherwise.

---

## 3 · Package Manager & Commands

Use **pnpm 9+** exclusively (never npm, never yarn).

| Task | Command |
|------|---------|
| Install deps | `pnpm install --frozen-lockfile` |
| Dev server | `pnpm dev` |
| **Master verify gate** | `pnpm run verify` |
| Typecheck (whole app) | `pnpm run check` |
| Test one file | `pnpm exec vitest run path/to/file.test.ts --pool=forks --poolOptions.forks.singleFork=true` |
| Full suite (serial — Windows) | `pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true` |
| Route registry check | `pnpm run validate:routes` |
| Brand / source / hook linting | `pnpm run lint:brand-voice` · `lint:source` · `lint:hooks` |

> **Vitest note:** Parallel vitest rotates 5s-timeout import flakes on Windows — always pass `--pool=forks --poolOptions.forks.singleFork=true`.

> **Test hygiene (singleFork):** serial mode shares ONE process across ALL test files — one `globalThis`, one `process.env`, one `vi.mock` registry, one jsdom document. Leaks show up as order-dependent "intermittent" failures in *unrelated* files (purged repo-wide in PRs #515/#517). Rules for every test file:
> - Needs a REAL shared module (db, drizzle schema/orm, mysql2, sms, email-notify)? Hoist `vi.unmock("<specifier>")` at the top — pattern precedent: `server/routers/voiceAgent.test.ts`.
> - Never leave an unused/partial `vi.mock` factory in a file (a dead partial db mock in winback.test.ts was the original flake source).
> - `vi.stubGlobal` / direct `global.fetch =` → restore in `afterEach` via `vi.unstubAllGlobals()`. `vi.doMock` → matching `vi.doUnmock` in `afterEach` (doMocks are NOT file-scoped here). The config-level `unstubGlobals`/`unstubEnvs` flags are a safety net, not a license to skip per-file cleanup.
> - `process.env.X = ...` → restore-or-delete in afterEach/afterAll. Two known foot-guns: `if (orig) env.X = orig` leaks when orig was undefined; `env.X = undefined` stores the literal string `"undefined"`.
> - Cleanup inside a test body must be `try/finally` — a failed assertion skips trailing cleanup lines (fake timers, env deletes).
> - RTL renders are auto-unmounted by the `afterEach(cleanup)` in `client/src/__tests__/setup.ts` (RTL auto-cleanup can't self-register because `globals: true` is off) — don't remove it.
> - Prove order-independence before shipping test changes: `pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true --sequence.shuffle.files --sequence.seed=N` forces a deterministic file order; sweep a few seeds.

> **Worktree note:** Fresh worktrees created via `scripts/worktree-setup.ps1` do NOT need `pnpm install` — `node_modules` are junctioned automatically. Only run `pnpm install --frozen-lockfile` if deps changed.

---

## 4 · Branching & CI/CD

### Branch Model (Trunk-Based)
```
main (protected) ← squash-merge only, operator gates
  └── nickstire/<task>    ← all nickstire work
  └── chore/<task>
  └── docs/<task>
```

**Hard rules:**
- **NEVER push directly to `main`** — use `nickstire/<task>` branches + PR
- Stage only explicit file paths — never `git add -A`
- PRs are squash-merged — never stack on another open PR's commits
- Scope every commit to the assigned task ONLY

### CI Gate (Pre-Push)
`.husky/pre-push` runs `turbo build --affected`. This MUST pass before push.

Full verify gate (run before pushing):
```powershell
cd apps/nickstire; pnpm run verify
```

### Success Metrics
| Signal | Target |
|--------|--------|
| `pnpm run verify` | Exit 0 |
| TypeScript errors | 0 |
| Test pass rate | 100% |
| Route registry | All routes registered |
| Brand voice violations | 0 |

---

## 5 · Code Ownership & Governance

There is no `CODEOWNERS` file. Ownership is enforced by:

| Layer | Mechanism |
|-------|-----------|
| App-level rules | This file (`apps/nickstire/AGENTS.md`) |
| Protected code | [`PROTECTED-CORE.md`](./PROTECTED-CORE.md) — never modify without explicit approval |
| Cross-cutting rules | Root [`AGENTS.md`](../../AGENTS.md) + CIITTY v2.1 |
| PR gate | Operator merges all PRs — no direct main push |
| DB schema | `drizzle/schema.ts` is source of truth — migrations are hand-applied SQL |
| External side effects | All owner-gated (see §6) |

**Governance checks (automated):**
- `pnpm run validate:routes` — every route in `shared/routes.ts`
- `pnpm run lint:brand-voice` — claim safety enforcement
- `pnpm run lint:source` — source dependency rules
- `pnpm run lint:hooks` — hook conventions

**PR final report format** (required):
```
Branch: nickstire/<task> · SHA: <short>
Changed files: <list>
Checks run: check ✅ · verify ✅ · validate:routes ✅
Intentional exclusions: <none or explain>
```

---

## 6 · Key Conventions & Standing Rules

### Database
- **Migrations are hand-applied SQL** (`drizzle/*.sql`) — no auto-migrate; never run without explicit operator approval
- `drizzle/schema.ts` is the source of truth — don't edit generated files directly
- TiDB Cloud (MySQL) — NOT Postgres; Drizzle ORM, NOT Prisma

### Content & Claim Safety
- **No invented warranties, wait-times, or reviews** — no "guaranteed", no fabricated timelines
- **Payment language:** "Payment Programs" not "financing"
- **Used-tire pricing is two-tier:** WEB says "from $25 installed (select 12-inch; most $40-80)"; quoting channels say $60. Do NOT "fix" either direction — both are intentional
- **Brand voice linting** (`lint:brand-voice`) enforces these — run it before pushing

### External Side Effects (Owner-Gated)
Never execute live without explicit operator approval in a dedicated PR:
- Live GBP / Instagram / Facebook posts
- Review replies
- SMS or email sends
- Stripe / refund calls
- Supplier orders

**Build preview/draft/copy-only**. Kill-switches flip only in approved PRs.

### iOS PWA
- `window.confirm / alert / prompt` are silently suppressed in iOS standalone — **never use them**
- Use in-DOM confirms (two-tap pattern) for any destructive action
- Minimum 48×48px touch targets

### Prerendering
- **Never hand-edit `prerendered/`** — run `pnpm run prerender` (currently broken on Windows; CI regenerates)

---

## 7 · Common Gotchas / Lessons Learned

- **pnpm frozen-lockfile mode in CI:** After any `package.json` dep change (add/move/remove), regenerate `pnpm-lock.yaml` locally and commit it — Railway CI will reject stale lockfiles.
- **Vitest parallel flakes on Windows:** Always pass `--pool=forks --poolOptions.forks.singleFork=true` — parallel runs rotate 5s-timeout import errors.
- **singleFork = shared process:** `vi.mock`/global/env/DOM state leaks across test FILES in serial mode. Follow the Test-hygiene rules in §3 — a leaked partial mock surfaces as intermittent `No "X" export is defined on the "Y" mock` failures in unrelated files.
- **Shared types/nav/constants are a quad:** Adding a new admin section requires updating all four files in `shared/` — missing one breaks the UI silently.
- **Route registry is the gate:** `validate:routes` fails if a new route isn't in `shared/routes.ts` — don't skip this check.
- **TiDB is MySQL-compatible, not Postgres:** Never use Postgres-only SQL constructs (e.g. `RETURNING`, `ON CONFLICT DO UPDATE`). Drizzle's MySQL dialect handles this, but raw SQL must be MySQL-safe.
- **SMS/VAPI = server/** — voice and SMS logic lives in `server/`, not client. The client triggers via tRPC; never call Twilio/VAPI directly from the browser.
- **Brand voice is a CI gate:** Claim safety violations (`lint:brand-voice`) block the verify pipeline — intentional, not a fluke.

---

## 8 · How to Resume in a Fresh Session

```powershell
cd C:\Users\nourd\NOURCITY
git fetch origin
powershell scripts/worktree-setup.ps1 -branchName nickstire/<task> -targetDir .worktrees/<name>
cd .worktrees/<name>/apps/nickstire
git log --oneline -10
# Read truth_os.md for current prod state
# Read PROTECTED-CORE.md for no-touch list
pnpm run verify   # full gate — must be green before any work
```

---

## 9 · Agent Framework Reference

This app is governed by **CIITTY v2.1** — the monorepo-wide agent operating framework.

📄 [`/.agents/frameworks/ciitty/SKILL.md`](../../.agents/frameworks/ciitty/SKILL.md)

Key rules that always apply here:
- **Blind Spot Check** before any change: does this break statenour? does pnpm-lock.yaml need updating? will Railway rebuild?
- **Forgotten Factor Protocol**: before closing — what route/cron/webhook/env var depends on what I just changed?
- **No direct main push** — always `nickstire/<task>` branch
- **Lockfile sync** — any dep change = regenerate and commit `pnpm-lock.yaml`
- **Owner-gated side effects** — never execute live external actions without approved PR
