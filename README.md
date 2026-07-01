# Nour monorepo (`nour-monorepo`)

> One repository · four Railway services · one bill · two concurrent AI-agent sessions.

This is a private, single-owner monorepo housing two production web products and the
infrastructure that supports them. It is managed with **pnpm workspaces + Turborepo** and
deploys to a single **Railway** project. Everything ships from one branch — `main`.

If you are an agent or developer touching one app, read that app's `apps/<app>/AGENTS.md`
(and `CLAUDE.md` where present) **first** — those are the per-app bibles. This root README
is the cross-cutting map: topology, getting started, the build/verify/deploy pipeline, and
the gotchas that bite everyone.

---

## Table of Contents

1. [The four apps at a glance](#the-four-apps-at-a-glance)
2. [Tech stack](#tech-stack)
3. [Repository topology](#repository-topology)
4. [Monorepo Strategy & Governance](#monorepo-strategy--governance)
5. [Prerequisites](#prerequisites)
6. [Getting started](#getting-started)
7. [The Turborepo + pnpm pipeline](#the-turborepo--pnpm-pipeline)
8. [Per-app architecture](#per-app-architecture)
9. [How the apps talk to each other](#how-the-apps-talk-to-each-other)
10. [Environment variables](#environment-variables)
11. [Scripts reference](#scripts-reference)
12. [Databases](#databases)
13. [Testing](#testing)
14. [Verify gates & git hooks](#verify-gates--git-hooks)
15. [Continuous integration](#continuous-integration)
16. [Deployment (Railway)](#deployment-railway)
17. [Working on the shared `main` branch](#working-on-the-shared-main-branch)
18. [Troubleshooting](#troubleshooting)
19. [Conventions & rules of the road](#conventions--rules-of-the-road)
20. [Documentation map](#documentation-map)

---

## The four apps at a glance

| Path | Package name | What it is | Deploys to |
|---|---|---|---|
| `apps/nickstire/` | `nicks-tire-auto` | Vite 7 + React 19 PWA front-end · Express 4 + tRPC 11 back-end · Drizzle ORM on **TiDB Cloud (MySQL)**. The public tire-shop site + autonomous SMS/voice/AI ops backend + `/admin` console for **Nick's Tire & Auto** (Cleveland, OH). | Railway `MAINnicks-tire-auto` → **nickstire.org** |
| `apps/statenour/` | `@statenour/web` | Next.js 16 (App Router, standalone) · Prisma 7 on **Neon Postgres + pgvector**. "NOUR OS" — a single-operator personal operating system (goals/missions/tasks, journals, people, an XP "character sheet", and an autonomous AI agent with grounded recall). | Railway `statenour-web` → **bdnick.info** |
| `apps/worker/` | `@statenour/worker` | Express 4 + `node-cron`. A thin, secret-gated **cron dispatcher** — it forwards scheduled ticks over Railway's internal network to `statenour-web`'s `/api/cron/*` handlers. Holds no business logic and no database client. | Railway `statenour-worker` (internal only) |
| `apps/voice/` | `statenour-voice` | **Python** LiveKit Agents + OpenAI Realtime voice agent. Not a pnpm/Turbo package — it has its own Dockerfile and `requirements.txt`. | Railway `statenour-voice` (internal only) |

> The two **web products are independent** — different frameworks, different databases,
> different domains. They share only this repo, the Turbo/pnpm tooling, the `main` branch,
> a small bridge contract, and three workspace packages.

---

## Tech stack

**Shared / monorepo**
- **Language:** TypeScript `5.9.x` (the three Node apps); Python 3.x (`apps/voice`)
- **Runtime:** Node `>=20`
- **Package manager:** `pnpm@10.4.1` (Corepack-pinned with an integrity hash in `package.json`)
- **Task runner:** Turborepo (pinned `^2.5.8`)
- **Workspaces:** `pnpm-workspace.yaml` → `apps/*` + `packages/*`

**`apps/nickstire`** — Vite `^7.3` · React `^19.2` · wouter `3.7.1` (patched) · TanStack Query `^5` · tRPC `^11.6` · Tailwind CSS `^4.1` · Express `^4.21` · Drizzle ORM `^0.45` on `mysql2` → TiDB Cloud · Stripe · web-push · Twilio · Resend · `@aws-sdk/client-s3` · Vitest `^2.1` · Puppeteer (prerender). AI is called over HTTP (Venice/OpenAI/Anthropic/Ollama) — no first-party AI SDK dependency.

**`apps/statenour`** — Next.js `^16.2` (App Router, `output: "standalone"`) · React `^19.2` · Prisma `^7.5` + `@prisma/adapter-neon` → Neon Postgres · tRPC `^11` · Vercel AI SDK `ai@6.0.162` (patched) with `@ai-sdk/anthropic` + `@ai-sdk/openai` · NextAuth `^5` (Google) · Inngest `^4.4` (cron fan-out) · Three.js / R3F · Tailwind CSS `^4.2` · Vitest `^3.2` · Playwright.

**`apps/worker`** — Express `^4.21` + `node-cron` `^3`. Two source files, two runtime deps. No DB, no ORM, no AI SDK.

**`apps/voice`** — Python, LiveKit Agents + OpenAI Realtime (`agent.py`, `requirements.txt`).

---

## Repository topology

```
NOURCITY/
├─ apps/
│  ├─ nickstire/        # nicks-tire-auto — Vite+Express, TiDB        → nickstire.org
│  ├─ statenour/        # @statenour/web  — Next.js, Neon+pgvector    → bdnick.info
│  ├─ worker/           # @statenour/worker — Express+node-cron relay (internal)
│  └─ voice/            # statenour-voice — Python LiveKit agent (internal, non-pnpm)
├─ packages/
│  ├─ utils/            # @nour/utils — shared TS utils (cn, with-timeout); built dist/
│  ├─ lenses/           # @statenour/lenses — strategic-reasoning framework registry
│  └─ chrome-extension/ # @statenour/chrome-extension — MV3 brain-capture extension
├─ docs/                # MIGRATION_PLAN.md, MIGRATION_AUDIT.md, RAILWAY_PROVISION.md, adr/
├─ scripts/             # repo-level helper scripts
├─ .husky/              # pre-commit + pre-push git hooks (the REAL gates)
├─ .github/workflows/   # test.yml · lighthouse-ci.yml · prerender-refresh.yml
├─ .worktrees/          # git worktrees used by concurrent agent sessions
├─ package.json         # root scripts (turbo wrappers) + pnpm patches/overrides
├─ pnpm-workspace.yaml  # apps/* + packages/*
├─ pnpm-lock.yaml       # single root lockfile
├─ turbo.json           # task graph (build/check/typecheck/lint/test/dev/start)
├─ CLAUDE.md            # cross-cutting agent rules (read this if you are an agent)
└─ README.md            # ← you are here
```

There is **no root `tsconfig.json`** — each app/package owns its own. There is **no root
Dockerfile** — `statenour`, `worker`, and `voice` each ship their own; `nickstire` builds
via Railway dashboard commands (see [Deployment](#deployment-railway)).

### Workspace packages

| Package | Name | Purpose | Consumed by |
|---|---|---|---|
| `packages/utils` | `@nour/utils` (0.2.0) | Shared TS helpers — `./cn` (clsx + tailwind-merge), `./with-timeout`. Ships a tsc-built `dist/`. | statenour (others declare it; worker does not import it) |
| `packages/lenses` | `@statenour/lenses` (0.1.0, MIT) | Typed registry of strategic reasoning frameworks (first-principles, JTBD, Porter…) with trigger regexes + prompt blocks. | statenour `lib/ai/strategic-frameworks/` |
| `packages/chrome-extension` | `@statenour/chrome-extension` (0.2.1) | MV3 Chrome extension for quick "brain dump" capture (custom `scripts/build.mjs`). | standalone (not imported) |

> A change inside `packages/**` makes Turbo treat **all consuming apps as affected** — so a
> `@nour/utils` edit will rebuild statenour (and anything else that imports it) on the next
> `--affected` build or push.

---

## Monorepo Strategy & Governance

This monorepo operates under a strict strategic playbook to mitigate the inherent risks of centralized code. A monorepo forces collaboration, which means without machine-enforced governance, the `main` branch will fracture.

### 1. Machine-Enforced Code Ownership & Boundaries
Human reviews fail at scale. We use implicit ownership and automated path-based CI triggers.
- **Conway's Law Mitigation**: Apps remain strictly decoupled. `apps/nickstire` and `apps/statenour` do not import each other. The only cross-app boundaries are `/api/bridge/*` contracts and `packages/*`.
- **Blast Radius**: A single bad bump in a shared library (`packages/*`) can take down the entire workspace. Turborepo's affected-graph execution ensures that CI only builds and tests what was actually impacted, isolating the blast radius.

### 2. Trunk-Based Development
Long-lived branches guarantee unresolvable merge conflicts. **All changes go to `main`**. We employ Trunk-Based Development with high-fidelity test coverage and strict CI verify gates (pre-push hooks) to protect the trunk. 

### 3. Git Performance
Git natively struggles as monorepos grow. To prevent degraded local I/O performance on developer machines:
- Use **Git Sparse-Checkout** if you are only working on a single app for an extended period.
- Routinely clean up stale worktrees (`git worktree prune`) and drop unused caches.
- For massive scaling, consider Microsoft's **Scalar**, though our current Turborepo + pnpm caching handles our scale well.

---

## Prerequisites

- **Node.js `>=20`** (match the Railway runtime — Node 20). Use `nvm`/`fnm`/`volta`.
- **pnpm `10.4.1`** — `corepack enable && corepack prepare pnpm@10.4.1 --activate` (the repo pins it; do not use a different major).
- **Git** with the hooks path set (the root `prepare` script does `git config core.hooksPath .husky` automatically on install).
- **Database access** is only needed for full runtime, not for `pnpm install`/build:
  - nickstire → a **TiDB Cloud (MySQL)** connection string.
  - statenour → a **Neon Postgres** connection string (pooled + direct).
- **Python 3.x** only if you work on `apps/voice` (it is otherwise self-contained).
- **Optional:** Docker (to reproduce the statenour/worker/voice production images locally).

---

## Getting started

### 1. Clone & install (once, at the root)

```bash
git clone https://github.com/nourdean22/MAINnicks-tire-autoNEW.git NOURCITY
cd NOURCITY
corepack enable
pnpm install            # installs ALL workspaces + reapplies the wouter/ai patches
```

> `pnpm install` reapplies `pnpm.patchedDependencies` (`wouter@3.7.1` for nickstire,
> `ai@6.0.162` for statenour). If those patches ever fail to apply, do a clean reinstall:
> `rm -rf node_modules && pnpm install`.

### 2. Configure environment

Each app reads its own env file. Copy the examples where they exist and fill in the values
(see [Environment variables](#environment-variables) — **never commit real secrets**):

```bash
cp apps/nickstire/.env.example apps/nickstire/.env      # exists
cp apps/statenour/.env.example apps/statenour/.env.local # exists
# apps/worker has NO .env.example — it only needs CRON_SECRET + STATENOUR_WEB_URL locally
# apps/voice uses its own Python env (see apps/voice/README.md)
```

### 3. Run an app in dev

```bash
# nickstire — Express server + Vite client in one watcher (PORT configurable via env)
pnpm nick dev           # alias for: pnpm --filter nicks-tire-auto dev

# statenour — Next.js dev (webpack) on port 3001
pnpm stn dev            # alias for: pnpm --filter @statenour/web dev

# worker — node-cron relay (needs CRON_SECRET; forwards to STATENOUR_WEB_URL)
pnpm worker dev         # alias for: pnpm --filter @statenour/worker dev

# statenour crons in dev (Inngest dev server)
pnpm --filter @statenour/web inngest:dev
```

The root `package.json` exposes `pnpm nick`, `pnpm stn`, and `pnpm worker` as filter
shortcuts — append any script (`dev`, `build`, `test`, …).

---

## The Turborepo + pnpm pipeline

`turbo.json` defines the task graph. The important tasks:

| Task | `dependsOn` | Notes |
|---|---|---|
| `build` | `^build` | Builds upstream workspace deps first. Outputs: `.next/**`, `.next-prod/**` (statenour), `dist/**`, `client/dist/**`, `node_modules/.prisma/**`. Test/markdown files excluded from inputs. |
| `check` / `typecheck` | `^build` | `tsc --noEmit`. |
| `lint` | — | per-app linter. |
| `test` | `^build` | Vitest; coverage cached. |
| `dev` / `start` | — / `build` | `cache: false`, `persistent: true`. |

`globalEnv` (busts the cache on change): `NODE_ENV`, `CI`, `VERCEL`, `RAILWAY_ENVIRONMENT`.
The `build` task additionally declares `DATABASE_URL`, `DIRECT_URL`, the AI-provider keys,
and `BUILD_COMMIT`/`BUILD_BRANCH` as cache inputs.

### Root commands (turbo wrappers)

```bash
pnpm build:all          # turbo run build (all apps)
pnpm build:affected     # turbo run build --affected   (only what changed vs origin/main)
pnpm build:nick         # turbo run build --filter=nicks-tire-auto
pnpm build:stn          # turbo run build --filter=@statenour/web
pnpm build:worker       # turbo run build --filter=@statenour/worker

pnpm test:all | test:affected | test:nick | test:stn
pnpm check:all | check:affected
pnpm lint:all  | lint:affected

pnpm verify:nick        # nickstire master gate (env+check+lint+tests+build)
pnpm verify:affected    # turbo run check lint test --affected
pnpm ci:affected        # turbo run check lint test build --affected  (what CI runs)
```

> `--affected` diffs `HEAD` against `origin/main` and runs the task for changed packages
> **plus their workspace dependents**. This is why a nickstire-only change can still trigger
> a statenour build at push time (Turbo includes both in the affected set) — see
> [Troubleshooting](#troubleshooting).

---

## Per-app architecture

### `apps/nickstire` (nicks-tire-auto)

The customer site + an autonomous operations backend for the shop.

- **Single Express entry:** `server/_core/index.ts` — all tRPC routers and Express routes
  mount here. (As of `e81a6815` the entry was split into `server/routes/*`,
  `server/services/migrations.ts`, and `server/middleware/rateLimiters.ts`, all mounted via
  `register*(app)` calls from the entry.)
- **`server/`** (mostly flat, tests colocated): `_core/` (entry, trpc, context, env, oauth,
  vite, llm), `routers/` (~60 tRPC routers — admin, booking, vapi, voiceAgent, smsBot,
  estimates, payments, memberships…), `routes/` (Express webhooks + strategist endpoints),
  `services/` (~120 business modules — SMS, VAPI/voice, AI generators, GBP/social,
  declined-work recovery, dispatch, classifiers), `cron/` (scheduler + jobs).
- **`client/`** — React 19 PWA: `src/{pages,components,hooks,contexts,lib}`, `App.tsx`,
  `main.tsx`. Routing via `wouter`.
- **`drizzle/`** — `schema.ts` is the DB source of truth + hand-applied `*.sql` migrations.
- **`prerendered/`** — generated static HTML served to bots/AEO; **never hand-edit**.
- **Build:** `vite build` (client → `dist/public`) → `esbuild server/_core/index.ts`
  (→ `dist/index.js`, ESM, deps external) → `scripts/build-maybe-prerender.mjs` (skips
  prerender unless `PRERENDER_ON_BUILD=true`). At runtime the server serves the client from
  `dist/public`.

### `apps/statenour` (@statenour/web)

"NOUR OS" — a personal operating system with an autonomous agent.

- **App Router** under `app/(mastery)/` — `chat`, `stats`, `missions`, `journal`, `people`,
  `brain`, `goals`, `system`, `settings`, … plus `app/api/*` (~80 route groups incl. `ai`,
  `chat`, `cron`, `inngest`, `brain`, `bridge`, `sync`, `telegram`, `vapi`).
- **`lib/`** — `mastery/` (the XP/stats "character sheet" spine, e.g. `goal-stats.ts`),
  `brain/` (BrainMemory + pgvector recall + BGE reranker + people-intelligence),
  `trpc/routers/` (the API; `system/` is a per-domain split), `ai/` (provider chain + the
  5-layer fabrication-defense stack + system prompt), `db/` (`pgvector.ts`,
  `schema-sentinel.ts`).
- **Build:** `prisma generate && next build` (`output: "standalone"` → `.next/standalone`).
  Local prod builds use `NEXT_DIST_DIR=.next-prod` so a running dev server on `.next` isn't
  clobbered. `typescript.ignoreBuildErrors: true` works around a `googleapis`/Turbopack
  `.d.ts` crash — **real type errors are caught by `pnpm typecheck`, not the build.**
- **Crons** run via the **Inngest** mega fan-out; the single source of truth is
  `config/crons.ts` (verified by `pnpm check:crons`).

### `apps/worker` (@statenour/worker)

A deliberately thin **cron dispatcher** — not where jobs run.

- **Two source files:** `src/index.ts` (Express: `/health` + `POST /cron/mega` +
  `POST /cron/mega-evening`, enforces `CRON_SECRET`, refuses to boot without it) and
  `src/scheduler.ts` (an in-process `node-cron` loop for sub-hourly jobs).
- Every tick **forwards an authenticated `fetch` to `STATENOUR_WEB_URL/api/cron/<name>`**
  (fire-and-forget, 60s timeout) — the worker holds no business logic and touches no DB.
- High-frequency jobs (all UTC): `brain-bus-backfill` (2m), `error-telegram-push` (5m),
  `alert-telegram-push` (15m), `calendar-premeeting` (15m, daytime), `bus-exhaustion-watch`
  (30m), `provider-ping` (hourly). Daily/weekly jobs ride the `/cron/mega*` endpoints that
  Railway's scheduler hits. The authoritative job registry lives in
  `apps/statenour/config/crons.ts`; the worker's table is a per-deploy snapshot.
- Operator controls (kill-switch / run-now / status) live on statenour-web's cron deck.

### `apps/voice` (statenour-voice)

A Python LiveKit Agents voice agent (`agent.py`) using OpenAI Realtime. Self-contained:
its own `Dockerfile` (build context `apps/voice/` only) and `requirements.txt`. It is
**outside the pnpm/Turbo graph** — `pnpm install`/`turbo` ignore it; it builds and deploys
independently on Railway. See `apps/voice/README.md` + `apps/voice/DEPLOY.md`.

---

## How the apps talk to each other

- **nickstire ↔ statenour bridge:** nickstire exposes `/api/bridge/*` endpoints,
  authenticated with the `STATENOUR_SYNC_KEY` header (timing-safe). statenour consumes them
  for cross-app data. This contract is intentionally narrow and stable.
- **worker → statenour:** the worker forwards cron ticks to statenour-web over Railway's
  **internal network** (`*.railway.internal`), authenticated with `CRON_SECRET` as a bearer
  token. No public traffic; one ~5–15 ms hop per fire.
- **No other cross-app coupling.** Apps do **not** import each other's internal `lib/`
  modules — only the bridge contract and the `packages/*` workspace packages cross app
  boundaries.

---

## Environment variables

Values live in Railway per-service variables and local `.env`/`.env.local` files (and a few
operator-only credential files outside the repo). **Never commit secrets.** Validators:
nickstire `pnpm --filter nicks-tire-auto env:validate`; statenour `pnpm --filter @statenour/web check:env`.

### nickstire (selected — see `apps/nickstire/.env.example` for the full, annotated list)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | TiDB Cloud (MySQL) connection — **required** |
| `JWT_SECRET`, `ADMIN_API_KEY` | Session/JWT signing + admin API auth — **required** |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, `OWNER_OPEN_ID` | Admin Google OAuth login |
| `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` / `_EMAIL` | PWA web-push |
| `VENICE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_MODEL` | AI provider keys (selection in app config) |
| `TWILIO_*`, `OWNER_PHONE_NUMBER`, `STORE_PHONE` | SMS + alert numbers |
| `STRIPE_SECRET_KEY` / `_PUBLISHABLE_KEY` / `_WEBHOOK_SECRET` | Payments |
| `META_*` / `FB_*`, `GA4_*`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID` | Social autoposting, analytics, GBP |
| `STATENOUR_SYNC_URL`, `STATENOUR_SYNC_KEY`, `BRIDGE_API_KEY` | Cross-app bridge |
| `CRON_SECRET` | Auth for `/api/cron/*` |
| `SMS_KILL_SWITCH`, `VAPI_KILL_SWITCH` | Incident kill switches (Railway-managed) |

### statenour (selected — see `apps/statenour/.env.example`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection (`pgbouncer=true`) — **required** |
| `DIRECT_URL` | Neon direct (non-pooled) connection for migrations |
| `AUTH_SECRET`, `AUTH_GOOGLE_CLIENT_ID` / `_SECRET`, `AUTH_ALLOWED_EMAIL` | NextAuth (single-operator Google sign-in) |
| `OLLAMA_API_KEY` (+ `OLLAMA_MODEL`), `VENICE_API_KEY` (+ `VENICE_MODEL`), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | AI provider chain (Ollama Cloud primary -> Venice -> OpenAI -> Anthropic; see `lib/ai/provider.ts`) |
| `CRON_SECRET`, `STATENOUR_SYNC_KEY` | Cron + sync/bridge auth |
| `TELEGRAM_BOT_TOKEN` / `_CHAT_ID` / `_WEBHOOK_SECRET` | Ops alerts + ✓/✗ confirms |
| `TWILIO_*`, `VAPID_*`, `STRIPE_*`, `RESEND_API_KEY` | SMS, web-push, payments, email |
| `REDIS_URL` | Optional L2 cache (degrades to in-memory when unset) |
| `NEXT_DIST_DIR` | Build isolation (`.next-prod`) for local prod builds |

### worker (the only vars its code reads)

| Variable | Required | Purpose |
|---|---|---|
| `CRON_SECRET` | **Yes — fail-closed** (`process.exit(1)` if unset) | Gates inbound `/cron/*` + signs outbound forwards |
| `STATENOUR_WEB_URL` | Effectively | Base URL it forwards ticks to (`https://statenour-web.railway.internal`) |
| `PORT` | No (default `8080`) | Listen port |
| `SERVICE_ROLE` | No (default `worker`) | Cosmetic label in `/health` |

---

## Scripts reference

### Root (`package.json`)

| Command | Does |
|---|---|
| `pnpm nick <script>` / `stn` / `worker` | `pnpm --filter <app> <script>` shortcuts |
| `pnpm build:{nick,stn,worker,all,affected}` | Turbo builds |
| `pnpm test:{nick,stn,all,affected}` | Turbo tests |
| `pnpm check:{all,affected}` · `lint:{all,affected}` | Typecheck / lint |
| `pnpm verify:nick` · `pnpm verify:affected` · `pnpm ci:affected` | Aggregate gates |

### nickstire (`apps/nickstire`)

`dev` · `build` · `start` · `check` (tsc) · `test` (vitest) · `lint` (prettier on docs) ·
`lint:source` · `lint:hooks` · `lint:brand-voice` · `validate:routes` · `env:validate` ·
`prerender` / `regen` / `prerender:check` · `db:push` / `db:migrate` ·
**`verify`** (the master gate: `env:validate → check → lint → lint:source → lint:hooks → lint:brand-voice → validate:routes → test → build`).

### statenour (`apps/statenour`)

`dev` (port 3001) · `build` (`prisma generate && next build`) · `build:local`
(`NEXT_DIST_DIR=.next-prod`) · `start` · `typecheck` · `lint` (**eslint** — there is **no**
`lint:source`) · `test` / `test:watch` (vitest) · `test:e2e` (Playwright) ·
`check:env` · `check:crons` · `check:raw-sql` · `prompt:size-check` ·
**`verify:hard`** (`typecheck && lint && test && check:raw-sql && check:crons && prompt:size-check && prisma validate`) ·
`inngest:dev` · `smoke:prod` · `db:*` (Prisma).

### worker (`apps/worker`)

`build` (`tsc -p tsconfig.json`) · `start` (`node dist/index.js`) · `dev` (`tsx watch`) ·
`check` (`tsc --noEmit`).

---

## Databases

| App | Engine | ORM | Migrations |
|---|---|---|---|
| nickstire | **TiDB Cloud (MySQL)** | Drizzle ORM | **Hand-applied SQL** from `drizzle/*.sql`. Apply to the DB, then `pnpm run check`. |
| statenour | **Neon Postgres + pgvector** | Prisma 7 (`@prisma/adapter-neon`) | **Hand-applied** to prod Neon (often via a guarded `POST /api/system/apply-pending-migration`). |
| worker | none | — | — (talks only to statenour-web over HTTP) |

**statenour pgvector note:** `vector(N)` columns, the generated `tsvector` column, and the
HNSW index are declared `Unsupported(...)` in `schema.prisma` so Prisma sees them and won't
drop them; all vector queries go through raw SQL in `lib/db/pgvector.ts`. The schema has
~84 models. **Never run a Prisma migration with `--accept-data-loss`** — it silently nukes
the pgvector/tsvector columns. The `check:raw-sql` gate guards against shipping that.

**General rule for both apps:** apply the migration **first**, then deploy the code that
references the new columns (avoids "column doesn't exist" on the new revision).

---

## Testing

```bash
pnpm test:affected                      # only changed apps (fast)
pnpm --filter nicks-tire-auto test      # nickstire (vitest, ~720 tests, jsdom)
pnpm --filter @statenour/web test       # statenour (vitest, ~2900 tests)
pnpm --filter @statenour/web test:e2e   # statenour Playwright E2E
```

> Piping a test run to `tail`/`head` masks the exit code — **read the summary line**
> (`Tests N passed | M skipped`) and the process exit, not just the tail.

---

## Verify gates & git hooks

Hooks are wired via `core.hooksPath=.husky` (set by the root `prepare` script).

### Pre-commit (`.husky/pre-commit`)

Runs **only when `apps/nickstire/**` files are staged** (statenour-only commits skip it).
In cost order: `lint:brand-voice` → `lint:source` → `lint:hooks` → `validate:routes` →
`check` (tsc). The full test suite is deliberately **not** in pre-commit. There are no
statenour-side pre-commit checks.

### Pre-push (`.husky/pre-push`) — the real gate

Skips if there's no upstream tracking branch or you're pushing a tag. Self-heals stale
`apps/*/.next/lock`, then runs:

```sh
turbo run build --filter="...[<upstream>]" --output-logs=errors-only
```

i.e. it **builds every app changed since the upstream branch, plus its workspace
dependents.** This exists because a Next.js prerender bug (an unwrapped `useSearchParams`)
once cost 9 hours of Railway thrash — typecheck passed; only `next build` caught it. A
failure blocks the push. **Never bypass with `--no-verify`.**

> Per-app verification before pushing: nickstire → `pnpm verify:nick`; statenour →
> `pnpm typecheck && pnpm lint && pnpm test` (the `statenour-verify` skill's `lint:source`
> reference is stale — the linter is `eslint .`).

---

## Continuous integration

`.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `test.yml` ("CI · turbo-affected verify") | push + PR to `main` | Node 20, `pnpm install --frozen-lockfile`, then `turbo run check lint test build --affected`. Adds nickstire validators when nickstire changed + a non-blocking `pnpm audit`. |
| `lighthouse-ci.yml` | push to `main` + weekly (Mon 14:00 UTC) | Lighthouse against 6 production nickstire.org URLs; assertions are **warn-only**. |
| `prerender-refresh.yml` | weekly (Mon 08:00 UTC) | Regenerates `apps/nickstire/prerendered/*.html` (needs `DATABASE_URL` + `JWT_SECRET` secrets) and commits with `[skip ci]`. |

---

## Deployment (Railway)

All four apps live in one Railway project — **`natural-appreciation`** — on branch `main`,
each with its own **Root Directory + Watch Path** so only the changed app redeploys.

| Service | App | Build | Watch path |
|---|---|---|---|
| `MAINnicks-tire-auto` | nickstire | **No Dockerfile in repo.** Railway dashboard build/start commands (`pnpm --filter nicks-tire-auto build` / `start`), healthcheck `/api/health`. A legacy `vercel.json` remains for an install-command override. | `apps/nickstire/**` |
| `statenour-web` | statenour | `apps/statenour/Dockerfile` — 3-stage `node:20-alpine`, **build context = monorepo root** (builds `@nour/utils` + `@statenour/lenses` dist first), Next.js standalone, runtime `node apps/statenour/server.js`, `PORT=8080`. | `apps/statenour/**` |
| `statenour-worker` | worker | `apps/worker/Dockerfile` — 3-stage `node:20-alpine`, `pnpm deploy --prod --legacy` for a symlink-free artifact, `node dist/index.js`. Railway crons hit `/cron/mega` + `/cron/mega-evening`. | `apps/worker/**` |
| `statenour-voice` | voice | `apps/voice/Dockerfile` — Python image, build context `apps/voice/` only, `python agent.py`. Outside the Turbo graph. | `apps/voice/**` |

There are **no `railway.json`/`railway.toml`/`nixpacks.toml`/`Procfile`** files — deploy is
driven by the three Dockerfiles + nickstire's dashboard-configured commands. Operator
provisioning steps live in `docs/RAILWAY_PROVISION.md`.

**Deploy = push to `main`.** Railway watches the branch and rebuilds only the services whose
watch path changed. **Rollback:** Railway dashboard → service → Deployments → previous green
→ Redeploy. For a misbehaving statenour cron, kill it on the cron deck **before** rolling
back so the rollback doesn't immediately re-trigger it. For nickstire SMS/voice incidents,
flip `SMS_KILL_SWITCH=true` / `VAPI_KILL_SWITCH=true`.

---

## Working on the shared `main` branch

`main` is worked by **concurrent Claude agent sessions** (a statenour session and a
nickstire session, often in parallel `.worktrees/`). The protocol that keeps this safe:

```bash
# preferred: one command that fetch → rebase → warm-build → push, with race recovery
bash ~/push-main.sh            # local helper (not committed)
```

If pushing manually:

- **`git fetch origin` before every push.** `git log origin/main..HEAD` shows what rides
  along — commits that aren't yours are expected (the other session ships its own work).
- **Stage only your files by explicit path** (`git add apps/<app>/...`) — **never `git add -A`**.
- **Rebase, don't merge**, onto the latest `origin/main` — it keeps the diff clean so Turbo's
  affected set stays minimal (a merge commit can pull the *other* app into the affected
  build).
- The **pre-push hook builds both affected apps**, so the *other* session's broken or
  disk-starved working tree can bounce *your* push. Surface it; **never `--no-verify`** and
  never force-push shared history.

---

## Troubleshooting

**`os error 112` / `not enough space on disk` during a push.**
The pre-push hook builds the affected apps, including statenour's disk-hungry Next build.
The dev machine accumulates artifacts across multiple `.worktrees/` + `node_modules` + the
pnpm store. Free space safely: remove finished worktrees (`git worktree remove <path>`),
`pnpm store prune`, delete stale `.turbo`/`.next` dirs. Then re-push.

**A nickstire-only change still triggers a statenour build at push time.**
Turbo's `--affected`/`...[upstream]` set includes workspace dependents and is sensitive to
merge commits. **Rebase onto `origin/main`** instead of merging to keep the affected set to
just your app.

**Windows: "not a git repository" / ENOENT in Bash.**
The shell cwd resets to `C:\` between calls — prefix every Bash with
`cd /c/Users/nourd/NOURCITY/apps/<app> &&`.

**Windows: `Edit` `old_string` won't match.**
Unicode (`→ · ─` box-drawing, emoji) frequently fails to match — anchor on ASCII-only
substrings, or copy exact bytes from a fresh `Read`.

**Pre-push prints `IO error: provided value is too long when setting link name`.**
Non-fatal Windows symlink-path noise — the build still passes.

**`window.confirm` / `alert` / `prompt` silently do nothing.**
Both web apps run as **standalone iOS PWAs**, where these are suppressed. Use an in-DOM
confirm (two-tap button or a dialog component). See the `nickstire-ios-pwa-primitives` skill
(applies to statenour too).

**`pnpm install` breaks wouter (nickstire) routing.**
The `wouter@3.7.1` patch must reapply on install; on lockfile drift do
`rm -rf node_modules && pnpm install`.

**statenour `next build` passes but ships type errors (or vice-versa).**
Build-time TS checking is disabled (`ignoreBuildErrors: true`, a `googleapis`/Turbopack
workaround). Trust `pnpm typecheck`, not the build, for type safety.

---

## Conventions & rules of the road

- **Apps stay independent.** No cross-app imports of internal `lib/` modules — only the
  `/api/bridge/*` contract and `packages/*` cross boundaries.
- **Migrations are hand-applied** for both web apps. Apply first, deploy second. For
  statenour, never `--accept-data-loss` (it drops pgvector/tsvector).
- **Generated artifacts are not source.** Don't hand-edit `apps/nickstire/prerendered/*.html`
  (run `pnpm --filter nicks-tire-auto prerender`) or anything under `dist/`/`.next/`.
- **One branch, one bill.** Everything ships from `main`; Railway watch paths route each
  app's changes to its own service.
- **Read the app's `AGENTS.md` / `CLAUDE.md` first** before changing that app — they carry
  the load-bearing per-app detail this root README intentionally summarizes.

---

## Documentation map

| Doc | What |
|---|---|
| `CLAUDE.md` (root) | Cross-cutting agent rules: context routing, shared-`main` protocol, verify gates, Windows gotchas |
| `apps/nickstire/CLAUDE.md` | The real nickstire app bible (architecture, subsystems, gotchas) |
| `apps/nickstire/DEPLOY.md` · `PROTECTED-CORE.md` · `truth_os.md` | nickstire deploy contract, protected infra, prod-true state |
| `apps/statenour/AGENTS.md` · `DEPLOY.md` | statenour app bible + deploy contract |
| `apps/worker/DEPLOY.md` · `apps/voice/DEPLOY.md` | worker / voice deploy contracts |
| `docs/MIGRATION_PLAN.md` · `MIGRATION_AUDIT.md` | The 2026-05-17 Vercel→Railway monorepo migration (this repo absorbed statenour-os) |
| `docs/RAILWAY_PROVISION.md` | Operator handoff: Railway service + cron provisioning |
| `docs/adr/` | Architecture decision records |

> **History:** this repo began as `nickstire`. The statenour-os codebase was merged in on
> **2026-05-17** during a Vercel → Railway migration; the worker and voice services were
> carved out to host the long-running cron + voice workloads that don't belong on a web host.

---

> _Doc accuracy: the repository structure, scripts, env-var names, git hooks, CI, and deploy
> config in this README were verified against the actual repo files on **2026-06-01**.
> Framework versions, test counts, and Railway service identifiers are point-in-time — treat
> `package.json`, `turbo.json`, and each app's `DEPLOY.md` as the source of truth for current
> values._
