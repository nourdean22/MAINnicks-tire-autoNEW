# Migration Audit · statenour-os ⤴ nickstire · Vercel → Railway

> **Phase 1 deliverable. Read-only audit. Zero production changes.**
> Date: 2026-05-17 · Auditor role: senior infra engineer + migration lead
> Rollback anchor: tag `pre-migration-audit-2026-05-17` on `main`
> Branch: `migration/audit`

---

## 0 · TL;DR

The original brief assumed **one repo · one Next.js web service + one worker** — but the existing infrastructure makes this impossible without a rewrite.

- `nickstire` is **Vite + React SPA + Express server + Drizzle + MySQL (TiDB Cloud)**
- `statenour-os` is **Next.js App Router + Prisma + Postgres (Neon)**
- Two different frameworks, two different ORMs, two different DB engines, two different auth strategies. They **cannot share one runtime, one DB, or one user table.**

You have three viable paths. Pick one before Phase 2 begins.

| Path | Repos | Railway services | Effort | Risk | Matches your stated goals? |
|------|-------|------------------|--------|------|---------------------------|
| **A. Don't merge. Move statenour off Vercel as its own Railway project.** | 2 | 4 (nickstire-web, statenour-web, statenour-worker, nickstire-cron if needed) | LOW (1-2 days execution) | LOW | One bill ✓ · One repo ✗ (you said this is required) |
| **B. Monorepo. Two web runtimes side-by-side.** | 1 | 3 (nickstire-web, statenour-web, statenour-worker) | MEDIUM (3-5 days) | MEDIUM | One bill ✓ · One repo ✓ · One mental model ⚠ (still 2 frameworks under one tree) |
| **C. Rewrite statenour onto Vite+Express+Drizzle/MySQL.** | 1 | 2 (combined-web, worker) | HIGH (3-6 weeks) | HIGH | Matches stated shape · violates "move boxes, don't rebuild" |

**Recommendation: Option B (monorepo, two runtimes).** Gives you the "one repo" you said is required, preserves both apps unchanged, leverages the existing bridge for cross-system data, and is achievable in a week of careful execution. Option A is technically cleaner but violates your stated repo constraint. Option C violates your "don't rebuild" rule.

Operator: please confirm A, B, or C in your reply. Phase 2 work cannot start without this decision.

---

## 1 · CRITICAL findings (act before Phase 2 starts)

### 🔴 SEC-1 · Live production secrets sitting in nickstire local `.env`

Verified contents of `C:\Users\nourd\OneDrive\Desktop\nickstire-repo-staging\.env`:

- `STRIPE_SECRET_KEY=[REDACTED - ROTATE; see NEXT-BEST-ACTIONS.md]` (live Stripe key, full value)
- `STRIPE_WEBHOOK_SECRET=[REDACTED - ROTATE; see NEXT-BEST-ACTIONS.md]` (live webhook secret)
- `DATABASE_URL=[REDACTED - ROTATE; see NEXT-BEST-ACTIONS.md]` (live TiDB Cloud creds in plaintext)
- `GOOGLE_SERVICE_ACCOUNT_KEY` (full RSA private key PEM)
- `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `RESEND_API_KEY`, `META_PAGE_ACCESS_TOKEN`, `FB_APP_SECRET`, `GOOGLE_OAUTH_CLIENT_SECRET`
- Plaintext vendor passwords (`AUTO_LABOR_PASSWORD=[REDACTED]`, `GATEWAY_TIRE_PASSWORD=[REDACTED]`)

`.gitignore:23` correctly excludes `.env*` (except `.env.example`), so this file should not be on the remote. **Verify it never was** — run `git log --all --follow -- .env` on `origin/main`. If a single commit ever included it, every key in that list is compromised and must be rotated.

**[DECISION NEEDED · SEC-1]** Do you authorize a git history scan of the remote? Read-only, no destructive ops. Output the list of any commits that ever touched a `.env*` path. I will not rotate any key without your explicit instruction.

### 🔴 SEC-2 · `JWT_SECRET` is a guessable string

`C:\Users\nourd\OneDrive\Desktop\nickstire-repo-staging\.env:22`:
```
JWT_SECRET=nicks-tire-railway-jwt-secret-2026-march
```

This signs 30-day admin sessions for nickstire.org via Google OAuth. Any attacker who reads this repo (or guesses the pattern, which is trivial) can mint a valid admin token. **Production Railway env must use a 64+ character random value.**

**[DECISION NEEDED · SEC-2]** Authorize me to (a) generate a new high-entropy `JWT_SECRET`, (b) confirm whether your live Railway dashboard already has a different value set there, (c) plan the cutover so existing admin sessions don't lock you out.

### 🔴 SEC-3 · `/api/health/recover` has no auth gate

`server/_core/index.ts:254` mounts `app.post("/api/health/recover", recoverHandler)` with **no `requireAdminApiKey` middleware**. Any IP can POST. Even if `recoverHandler` is internally safe, this is defense-in-depth missing. Same fix shape as Wave 49 from statenour: add the existing `requireAdminApiKey` middleware in front of it.

**[DECISION NEEDED · SEC-3]** Authorize me to add the auth gate. 5-line change, zero behavior change for legitimate callers (you already use the admin key for every other admin route).

### 🟠 SEC-4 · statenour `AUTH_ALLOW_MOCK_IN_PROD` env var still exists

`lib/auth-guard.ts:78` in statenour-os reads `AUTH_ALLOW_MOCK_IN_PROD` and if set to `"1"` in production, bypasses auth checks entirely. Wave 49 routed the warning through structured logger so it lands in `/system/errors`, but the bypass still works if the env var is set.

**[DECISION NEEDED · SEC-4]** Confirm `AUTH_ALLOW_MOCK_IN_PROD` is NOT set in your current Vercel production env. If it is, this is P0 — fix in Vercel before migration starts.

### 🟠 SEC-5 · `RUNNER_SHARED_SECRET` empty-string risk

`lib/internal/runner-auth.ts` (statenour). Wave 49 removed the hardcoded `"statenour-local-runner"` fallback. The check now compares against `process.env.RUNNER_SHARED_SECRET` exactly. If the env var is empty AND the request header is empty, `timingSafeEqual("", "")` returns true — a subtle bypass.

**[DECISION NEEDED · SEC-5]** Confirm `RUNNER_SHARED_SECRET` is set to a non-empty value in your current Vercel env AND your local `local-agent/.env` matches.

---

## 2 · Repo inventories

### 2a · statenour-os

| Property | Value |
|---|---|
| Path | `C:\Users\nourd\NOUR-OS\apps\statenour-os` |
| Branch | `codex/ollama-local` |
| Remote | `https://github.com/nourdean22/statenour-os.git` |
| Framework | Next.js `^16.2.6` (App Router) |
| React | `^19.2.4` |
| Node | `>=20.0.0` |
| Package mgr | `pnpm@9.15.0` |
| ORM | Prisma `@7.5.0` |
| DB | Neon (Postgres) via `@prisma/adapter-neon@7.6.0` |
| Auth | NextAuth `5.0.0-beta.30` |
| Schema | `prisma/schema.prisma` · 73 models · ~2530 lines |
| API routes | 136 |
| Pages | 59 (all under `(mastery)` group · all auth-gated) |
| Cron schedules | 28 active in `config/crons.ts` + 60+ folded into mega = ~88 callable jobs |
| Dockerfile | ❌ not present |
| `output: 'standalone'` | ❌ not set in `next.config.ts` |
| Vercel-specific deps | `@vercel/analytics`, `@vercel/speed-insights` (both cosmetic, droppable) |
| Vercel-only runtime features | None (puppeteer was removed Wave 47 · uses Browserbase cloud browsers) |

### 2b · nickstire

| Property | Value |
|---|---|
| Path | `C:\Users\nourd\OneDrive\Desktop\nickstire-repo-staging` |
| Branch | `main` |
| Remote | `https://github.com/nourdean22/MAINnicks-tire-autoNEW.git` |
| Framework | **Vite 7 (client) + Express 4 (server)** · NOT Next.js |
| React | `^19.2.1` |
| Node | `>=20.0.0` |
| Package mgr | `pnpm@10.4.1` |
| ORM | Drizzle `^0.44.7` |
| DB | TiDB Cloud (MySQL) via `mysql2@^3.15.0` |
| Auth | Roll-your-own JWT via `jose@^6.1.0` + Google OAuth (admin) + phone OTP (customer) |
| Schema | `drizzle/schema.ts` · 81 tables · ~2640 lines |
| API routes | ~30 Express REST + 65 tRPC routers (mounted under `/api/trpc/*`) |
| Pages | ~60 public-facing + 30+ admin (client-side SPA routes) |
| Cron | Internal `setInterval` 4-tier scheduler in `server/cron/scheduler.ts` (24 jobs) · NO Railway cron config |
| Dockerfile | ❌ not present · uses Nixpacks auto-detection |
| Currently hosted on | Railway (confirmed by `RAILWAY_*` env vars + `RAILWAY_PUBLIC_DOMAIN=nickstire.org`) |
| Vercel-specific deps | `@vercel/analytics@^2.0.1` in production deps (telemetry leak only · benign) |
| Protected-core doc | `PROTECTED-CORE.md` lists 4 tiers of do-not-touch files |

### 2c · Why a literal merge is impossible

| Concern | statenour | nickstire | Conflict |
|---|---|---|---|
| Web runtime | Next.js (App Router, Node) | Vite SPA + Express server | **Cannot share one Node process** |
| Server-side rendering | App Router · RSC + streaming | Vite is client-only · Express serves API + static `dist/` | Different SSR models |
| ORM | Prisma | Drizzle | Different generated clients · different migration tooling |
| DB engine | Postgres (Neon) | MySQL (TiDB Cloud) | Different SQL dialects · different schemas |
| `users` table | NextAuth shape | Drizzle custom shape (loyalty + role + Google open ID) | **Incompatible · cannot merge** |
| Auth session | NextAuth JWT/session cookie | Custom `jose` JWT in cookie | Different signing keys + cookie names |
| Middleware | `middleware.ts` (Next.js Edge-style, but Node runtime) | Express middleware (inline) | Different request lifecycles |
| Package manager | `pnpm@9.15.0` | `pnpm@10.4.1` | Workspace-level conflict resolvable |
| `users` table existence | YES (NextAuth) | YES (Drizzle custom) | **NAMING + SHAPE COLLISION** |

A "literal merge" — moving statenour's `app/` directory into nickstire's tree and serving them from one process — would require rewriting one of the two apps. **That violates your "move boxes, don't rebuild them" non-negotiable.**

---

## 3 · Three viable paths

### Path A · Don't merge. Move statenour off Vercel as its own Railway project.

**What happens:**
- statenour stays on its own repo (`statenour-os`)
- New Railway project: `statenour-os` · 2 services (`web` + `worker`) + Neon stays as DB
- nickstire continues on its existing Railway project unchanged
- Existing `/api/bridge/*` endpoints + `STATENOUR_SYNC_KEY` continue to be the integration contract
- Vercel project for statenour decommissioned after stable cutover

**Operator goals matched:**
- ✅ One bill (one Railway account, two projects)
- ✅ Predictable ops (Railway pricing model)
- ✅ Worker absorbs cron + LLM orchestration (cost driver eliminated)
- ✅ "Move boxes, don't rebuild"
- ✅ Rollback path is trivial (Vercel project stays parked until cutover stable)
- ❌ Two repos (violates your stated requirement)
- ❌ Two mental models (also stated requirement)

**Effort: 1-2 days execution.** Lowest risk.

### Path B · Monorepo. Two web runtimes side-by-side. **(recommended if "one repo" is non-negotiable)**

**What happens:**
- Combine into ONE git repo under a monorepo root (pnpm workspaces)
- Layout:
  ```
  /
    apps/
      nickstire/        ← Vite + Express + Drizzle (unchanged tree)
      statenour/        ← Next.js + Prisma (unchanged tree)
      worker/           ← Node service for statenour crons + LLM orchestration
    packages/
      shared/           ← cross-app types only (no runtime code)
    pnpm-workspace.yaml
    package.json        ← root workspace manifest
  ```
- 3 Railway services from the one repo:
  - `nickstire-web` · serves nickstire.org · Vite SPA + Express server
  - `statenour-web` · serves admin (free Railway subdomain) · Next.js
  - `statenour-worker` · long-running · all crons + LLM orchestration + brain pipeline
- Bridge (`/api/bridge/*` + `STATENOUR_SYNC_KEY`) stays exactly as is
- Both DBs stay separate (nickstire keeps TiDB · statenour keeps Neon)
- Vercel decommissioned after stable cutover

**Operator goals matched:**
- ✅ One bill
- ✅ One repo (per your stated requirement)
- ⚠️ One mental model (still 2 frameworks under one tree, but at least one git history + one CI config + one CLAUDE.md)
- ✅ Worker absorbs cron + LLM orchestration
- ✅ "Move boxes, don't rebuild" (no app rewrites)
- ✅ Rollback path: revert to pre-merge tag on each repo individually

**Effort: 3-5 days execution.** Medium risk · most of the risk is in the Railway deploy config + the pnpm workspace migration of nickstire (its `pnpm@10.4.1` pin needs reconciling with statenour's `pnpm@9.15.0`).

**Key gotchas:**
- pnpm workspaces require a single root `pnpm-lock.yaml` · existing lockfiles must merge cleanly
- Each app keeps its own `node_modules` symlink to a hoisted root
- Railway services need separate build commands pointing at their app dir
- `PROTECTED-CORE.md` files (nickstire's) must move into `apps/nickstire/` but stay protected
- statenour's `data/skills-registry.json` (1,423 entries) keeps living in `apps/statenour/data/`
- Existing CI workflows on both repos must consolidate

### Path C · Rewrite statenour onto Vite+Express+Drizzle/MySQL.

**Dropped.** Violates "move boxes, don't rebuild." 3-6 week effort. Migrates 73 Prisma models + 136 API routes + 59 pages + the entire brain layer. Not happening this sprint.

---

## 4 · External services + env var surface

### 4a · statenour external services (29 distinct integrations)

| Category | Service | Env var(s) | Currently configured? |
|---|---|---|---|
| DB | Neon | `DATABASE_URL`, `DIRECT_URL` | ✅ |
| Cache | Redis/Upstash | `REDIS_URL`, `REDIS_KEY_PREFIX` | Optional · degrades to in-memory |
| AI | Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | ✅ |
| AI | Venice | `VENICE_API_KEY`, `VENICE_MODEL`, `VENICE_FAST_MODEL` | ✅ |
| AI | OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | ✅ |
| AI | Google Gemini | `GOOGLE_GENERATIVE_AI_API_KEY` | ✅ |
| AI | xAI Grok | `XAI_API_KEY` | ✅ |
| AI | HuggingFace | `HUGGINGFACE_API_KEY` | ✅ |
| AI | Perplexity | `PERPLEXITY_API_KEY` | ✅ |
| AI | Cohere (reranker) | `COHERE_API_KEY` | Optional |
| AI | Exa search | `EXA_API_KEY` | ✅ |
| AI | Tavily search | `TAVILY_API_KEY` | ✅ |
| AI | E2B code interp | `E2B_API_KEY` | ✅ |
| Voice | VAPI | `VAPI_WEBHOOK_SECRET` | ✅ |
| Voice | VideoDB | `VIDEO_DB_API_KEY` | ✅ |
| Email | Resend | `RESEND_API_KEY` | ✅ |
| Notif | Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | ✅ |
| Notif | Web Push (VAPID) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | ⚠ Wave 58 removed hardcoded fallback · must be set in Railway env or push is disabled |
| SMS | Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | ✅ (kill-switch flag exists per nickstire) |
| Auth | Google OAuth | `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` | ✅ |
| Google APIs | Sheets/Places/Calendar | `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID`, `GMAIL_REFRESH_TOKEN` | ✅ |
| Devices | Tuya | `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_API_ENDPOINT` | Local-agent only |
| Lead enrich | Apollo | `APOLLO_API_KEY` | ✅ |
| Project mgmt | ClickUp | `CLICKUP_API_KEY`, `CLICKUP_DEFAULT_LIST_ID` | ✅ |
| Meeting transcripts | Fireflies | `FIREFLIES_API_KEY` | ✅ |
| Automation | Make.com | `MAKE_WEBHOOK_URL`, `MAKE_WEBHOOK_SECRET`, `MAKE_WEBHOOK_API_KEY` | ✅ |
| Browser auto | Browserbase | `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | ✅ (replaces local puppeteer) |
| Social | Meta/Instagram | `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID`, `META_PAGE_ID` | ✅ |
| Repo | GitHub | `GITHUB_TOKEN` | ✅ |
| Payments (scaffold) | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Scaffolded · not active |
| Weather | OpenWeather | `OPENWEATHER_API_KEY`, `OPENWEATHER_CITY` | ✅ |
| Vercel infra | Runner trigger | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | Optional · used by GitHub integration's rollback action only |

### 4b · nickstire external services (mostly disjoint from statenour)

| Service | Env var(s) | Shared with statenour? |
|---|---|---|
| TiDB Cloud | `DATABASE_URL` | ❌ different engine |
| Stripe (live) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | ⚠ same vendor · different account? Verify |
| Twilio | `TWILIO_*` | Same vendor · likely same account |
| Capevace SMS Gateway | `SHOP_SMS_GATEWAY_URL`, `SHOP_SMS_GATEWAY_USERNAME`, `SHOP_SMS_GATEWAY_PASSWORD`, `SHOP_SMS_GATEWAY_WEBHOOK_SECRET` | nickstire-only |
| Resend | `RESEND_API_KEY` | Same vendor · likely same key |
| Venice | `VENICE_API_KEY` | ⚠ Same vendor · could share key |
| Google OAuth | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OWNER_OPEN_ID` | DIFFERENT vars from statenour's `AUTH_GOOGLE_*` — naming collision risk |
| Google Maps/Places/Sheets | `GOOGLE_MAPS_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_KEY` | Same SA key likely |
| VAPI | `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_FOLLOWUP_ASSISTANT_ID` | Same vendor · separate assistant |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Same bot likely |
| Meta/Facebook | `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN` | Same Page · could share creds |
| Snap Finance | `SNAP_FINANCE_API_KEY`, `SNAP_FINANCE_MERCHANT_ID`, `SNAP_FINANCE_WEBHOOK_SECRET` | nickstire-only |
| AWS S3 | `S3_BUCKET`, `AWS_REGION`, `CLOUDFRONT_DOMAIN` | nickstire-only (optional) |
| Sentry | `SENTRY_DSN` | nickstire-only (optional) |

### 4c · Env var name collisions (Path B only · monorepo mode)

If you choose Path B, the Railway services share one repo but get their env separately. Names that need explicit scoping:

| Collision | Resolution |
|---|---|
| `DATABASE_URL` | Different per service. nickstire-web → TiDB. statenour-web/worker → Neon. |
| `AUTH_SECRET` | nickstire doesn't use NextAuth · uses `JWT_SECRET` for its own auth. Statenour uses `AUTH_SECRET`. **No collision** but easy to confuse. |
| `RESEND_API_KEY` | Same vendor · likely same key · safe to share across all 3 services |
| `STRIPE_SECRET_KEY` | Verify whether nickstire uses live keys and statenour scaffolded uses test keys · if so, naming collision is real |
| `TELEGRAM_BOT_TOKEN` | Same bot · safe to share · but Telegram chat IDs differ per app |
| `VENICE_API_KEY` | Same vendor · likely safe to share |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Same SA likely · safe to share |
| `VAPI_*` | nickstire uses VAPI for customer voice receptionist · statenour uses VAPI for "Nick" assistant · likely DIFFERENT assistants · do NOT share |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` vs `AUTH_GOOGLE_CLIENT_ID/SECRET` | Different naming · safe but easy to confuse · document clearly |

**Recommendation:** in Path B's Railway dashboard, use Railway's "Shared Variables" feature for genuinely shared keys (Resend, Telegram bot, etc.) and per-service scopes for everything else.

---

## 5 · Cron + worker design

### 5a · statenour cron inventory (from `config/crons.ts`)

28 active schedules + 60+ folded into mega = ~88 callable cron routes. Top frequencies:

| Cron | Frequency | Where work belongs |
|---|---|---|
| `brain-bus-backfill` | every 2 min | worker (in-process loop) |
| `error-telegram-push` | every 5 min | worker (in-process loop) |
| `alert-telegram-push` | every 15 min | worker (in-process loop) |
| `calendar-premeeting` | every 15 min · 7am-8pm | worker (in-process loop) |
| `proactive-push` | 8am · 2pm · 9pm ET | worker (Railway cron OR in-process) |
| `mega` | 5am ET daily | Railway cron HTTP → worker |
| `mega-evening` | 10pm ET daily | Railway cron HTTP → worker |
| `provider-ping` | hourly | worker (in-process) |
| `embed-backfill` | every hour :30 | worker (in-process) |
| All other crons | various | folded into mega/mega-evening fan-out |

**Recommended architecture for crons (regardless of Path A or B):**

1. The worker service runs an internal `node-cron` (or BullMQ) scheduler that owns the high-frequency jobs (everything <hourly).
2. Railway's native cron service hits 2 HTTP endpoints daily: `worker.railway.app/cron/mega` and `worker.railway.app/cron/mega-evening`.
3. The mega fan-out continues to dispatch child cron routes inside the worker process · no behavior change from today.
4. `config/crons.ts` remains the single source of truth · just dispatched differently.

### 5b · Worker service responsibility split (statenour)

| Endpoint class | Web service | Worker service |
|---|---|---|
| Static + page rendering (`app/(mastery)/**`) | ✅ | — |
| `app/api/auth/**` | ✅ | — |
| `app/api/tasks/**` | ✅ (DB CRUD <100ms) | — |
| `app/api/settings/**` | ✅ | — |
| `app/api/health*/**`, `/api/system/cockpit` | ✅ | — |
| `app/api/webhooks/**` (Telegram, VAPI etc) | ✅ (quick ack) | — |
| `app/api/ai/chat/**` | — | ✅ (LLM streaming SSE) |
| `app/api/ai/assist/**` | — | ✅ (multi-agent) |
| `app/api/cron/**` (all 88) | — | ✅ |
| `app/api/events/stream` (SSE) | — | ✅ |
| `app/api/images/**` (generate/tournament) | — | ✅ |
| `app/api/integrations/research`, `/chain` | — | ✅ |
| `app/api/brain/**` | — | ✅ |
| `app/api/realtime/session` (VAPI) | — | ✅ |

Web and worker share the same Neon DB (separate connection pools). They communicate via shared DB state · the worker doesn't need an HTTP API back to the web service.

### 5c · nickstire cron stays unchanged

nickstire's 4-tier internal `setInterval` scheduler in `server/cron/scheduler.ts` continues to run inside the nickstire-web Express process. **It already works on Railway.** No migration needed.

---

## 6 · Risk surface · everything that could break

### 6a · Path A (separate repos) · risk surface

| Risk | Probability | Severity | Mitigation |
|---|---|---|---|
| Bridge contract drifts | Low | Medium | Lock `BRIDGE_API_KEY` · contract tests on both sides |
| Different Railway projects share Telegram bot · alert duplication | Medium | Low | Different `TELEGRAM_CHAT_ID` per service |
| Vercel cutover causes brief downtime | Low | Low | DNS swap can be staged · keep Vercel alive 24h after Railway green |

### 6b · Path B (monorepo) · risk surface

| Risk | Probability | Severity | Mitigation |
|---|---|---|---|
| pnpm workspace `@9` vs `@10` reconciliation fails | Medium | High | Build a throwaway test workspace first · use lockfile resolution flags |
| Lib name collisions (lib/auth, lib/logger, lib/utils, lib/prisma) | High | Low | Each app keeps its own `lib/` under `apps/*/lib/` · no cross-imports |
| Root `tsconfig.json` conflicts | Medium | Low | Each app keeps its own `tsconfig` · no monorepo-wide TS config |
| Existing CI workflows on both repos collide | Low | Medium | Consolidate into one `.github/workflows/` · matrix builds |
| `PROTECTED-CORE.md` files become harder to enforce | Medium | Medium | Move under `apps/nickstire/` · update doc paths · enforce in pre-commit |
| Railway services see wrong build dir | Medium | Medium | Each Railway service sets `Watch Paths` to its app dir · `Build Command` to `pnpm --filter <app> build` |
| Shared dependencies update breaks one app | Medium | Medium | Use exact-version pins · run both apps' test suites in CI |
| Worker DB connection pool exhaustion at peak | Low | High | Set `prisma.$connect` pool size carefully · share Neon pool limit |
| nickstire's `puppeteer` devDep installs in worker prod by accident | High | Medium | Worker Dockerfile must `NODE_ENV=production pnpm install --prod` OR worker doesn't include nickstire's package.json |

### 6c · Route collision audit (Path B only)

| URL path | nickstire | statenour | Collision? |
|---|---|---|---|
| `/api/auth/**` | ❌ uses `/api/oauth/callback` only | ✅ NextAuth catch-all | **No · different namespaces** |
| `/api/bridge/**` | ✅ owned by nickstire | ❌ statenour calls into this | **No · disjoint** |
| `/api/webhooks/**` | ✅ (sms-gateway, vapi, stripe, messenger) | ✅ (nickstire, gmail, etc) | ⚠ **Potential collision** · scope to `/api/webhooks/external/*` per service |
| `/api/system/**` | ✅ admin-only REST | ✅ admin dashboards | ⚠ **Potential collision** · gate by service host |
| `/api/cron/**` | ❌ no public crons | ✅ 88 cron routes | **No · disjoint** |
| `/api/admin/**` | ✅ admin REST | ❌ (statenour uses `(mastery)` page group) | **No · disjoint** |
| `/api/trpc/**` | ✅ all nickstire tRPC | ❌ statenour doesn't use tRPC | **No · disjoint** |

Most collisions disappear because the two apps deploy to different Railway services on different hostnames. The only real collision is if you try to put both under one Railway service (which Path B does NOT do).

---

## 7 · Cost model (Path B · the recommended option)

Rough monthly estimate, current usage patterns:

| Line item | Cost |
|---|---|
| Railway · `nickstire-web` (Hobby plan baseline) | $5 |
| Railway · `nickstire-web` compute (always-on, ~512MB) | $5-10 |
| Railway · `statenour-web` (Hobby plan baseline · or stays under Hobby cap if shared) | $0-5 |
| Railway · `statenour-web` compute (low traffic, admin-only) | $3-5 |
| Railway · `statenour-worker` (always-on, 1GB · the cost driver) | $15-25 |
| Railway · cron jobs (2x daily mega + a few HTTP cron jobs) | $0 (included) |
| Railway · network egress (mostly within RW for bridge) | $0-2 |
| **Railway subtotal** | **$28-52/mo** |
| Neon (Postgres) · current statenour usage | $0-19 depending on plan |
| TiDB Cloud (MySQL) · current nickstire usage | unchanged |
| Browserbase | unchanged · usage-based |
| Anthropic / Venice / OpenAI / Cohere etc | unchanged · usage-based |
| **Total monthly delta vs Vercel** | should be **-$50 to -$200 lower** depending on Vercel overage |

**Top 3 cost drivers post-migration:**

1. **Worker compute** (~$15-25/mo). Cap by: always-on but right-size the RAM. Start at 1GB · monitor heap usage · scale down if possible.
2. **Neon DB usage**. Cap by: ensure connection pooling is using `@neondatabase/serverless` (pgbouncer-style) · monitor compute-hours · stay on the Free or Launch plan.
3. **LLM API spend** (unchanged from Vercel). Cap by: Wave 59 cost wins (Anthropic 1h cache · 3 raw-OpenAI bypasses routed through Venice · Venice cache key task-aware) already shipped. Worker move doesn't change this.

---

## 8 · Migration prerequisites (Path B · what must exist before Phase 2 can produce a plan)

### 8a · statenour-os changes needed regardless

These are surgical, no behavior change, can ship today on `codex/ollama-local`:

- [ ] Add `output: 'standalone'` to `next.config.ts` (blocking · Railway Docker needs this)
- [ ] Add a `Dockerfile` using the Next.js standalone multi-stage pattern
- [ ] Replace `VERCEL_PROJECT_PRODUCTION_URL` reads with `APP_BASE_URL` (`app/api/cron/mega/route.ts:240`, `lib/services/cron-control.ts`)
- [ ] Replace `VERCEL_ENV === "production"` checks with `NODE_ENV === "production"` OR keep the OR condition (`lib/env.ts:31`, `lib/system/health-digest.ts:108`)
- [ ] Decide: keep `better-sqlite3` (Docker needs build-deps) OR migrate suggestion cache to Redis
- [ ] Verify `RUNNER_SHARED_SECRET` is non-empty in target Railway env (per SEC-5)
- [ ] Verify `AUTH_ALLOW_MOCK_IN_PROD` is NOT set in target env (per SEC-4)
- [ ] Verify `VAPID_PRIVATE_KEY` is set in target env (per Wave 58 fix)

### 8b · nickstire changes needed regardless

- [ ] Add auth gate to `/api/health/recover` (per SEC-3)
- [ ] Confirm `JWT_SECRET` is a high-entropy value in production Railway env (per SEC-2) · NOT the guessable string in local `.env`
- [ ] Add 9 missing env vars to `.env.example` (`VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_FOLLOWUP_ASSISTANT_ID`, `VOICE_AGENT_INTERNAL_SECRET`, `SNAP_FINANCE_API_KEY`, `SNAP_FINANCE_MERCHANT_ID`, `SNAP_FINANCE_WEBHOOK_SECRET`, `SENTRY_DSN`, `SMS_KILL_SWITCH`)
- [ ] Confirm `.env` was never committed to remote (per SEC-1 git history scan)

### 8c · Path B specific (if Path B chosen)

- [ ] Decide monorepo root location · proposed: keep nickstire repo as the new monorepo root (`MAINnicks-tire-autoNEW`)
- [ ] Reconcile `pnpm@9.15.0` (statenour) vs `pnpm@10.4.1` (nickstire) · safe: bump statenour to `pnpm@10.4.1`
- [ ] Decide statenour-web hostname · proposed: `statenour-admin.up.railway.app` (Railway free subdomain · `autonicks.com` dropped per operator)
- [ ] Decide whether `statenour-os` repo gets archived after merge (or kept as historical reference)
- [ ] Decide whether the `statenour-os-onfinish` directory at `C:\Users\nourd\NOUR-OS\apps\statenour-os-onfinish` is relevant or can be deleted

---

## 9 · [DECISION NEEDED] consolidated list

In order of urgency. None of these are touched without your explicit approval.

| ID | Decision | Severity | Why now |
|---|---|---|---|
| **D1** | **Pick Path A, Path B, or Path C** | BLOCKING | Phase 2 cannot start without this |
| SEC-1 | Authorize git history scan of nickstire `.env` exposure | HIGH | Determines blast radius |
| SEC-2 | Confirm production `JWT_SECRET` is rotated (not the guessable local value) | HIGH | Active admin session security |
| SEC-3 | Authorize auth gate on `/api/health/recover` | MEDIUM | Defense-in-depth |
| SEC-4 | Confirm `AUTH_ALLOW_MOCK_IN_PROD` is not set in prod Vercel env | HIGH | Auth bypass risk |
| SEC-5 | Confirm `RUNNER_SHARED_SECRET` is non-empty in prod Vercel env | HIGH | Empty-string bypass risk |
| D2 | Provision Railway services budget · approve $30-55/mo Railway cost | LOW | Cost cap |
| D3 | Decide statenour-admin hostname (`statenour-admin.up.railway.app` recommended) | LOW | Cosmetic · DNS-free |
| D4 | Decide fate of `statenour-os-onfinish` directory | LOW | Cleanup |
| D5 | Decide on cron architecture (in-process loop vs Railway cron HTTP vs hybrid) | MEDIUM | Architecture commit |
| D6 | Approve `output: 'standalone'` change to `next.config.ts` | LOW | Required for Docker · non-functional change |
| D7 | Decide better-sqlite3 future (keep + Docker build deps vs migrate to Redis) | LOW | Cleanup |

---

## 10 · What Phase 2 will produce (preview)

After you choose D1 (Path A / B / C) and clear the SEC items, Phase 2 produces `MIGRATION_PLAN.md` covering:

- Final directory layout (matches your chosen path)
- Auth strategy for statenour admin gating (Google OAuth recommended · same flow as nickstire admin · stub a separate session)
- Worker service Dockerfile + start command + healthcheck endpoint
- Railway service topology with explicit env scope per service
- Cutover sequence · 6-8 checkpoints · rollback path at each
- Concrete Linear issues under "NOUR OS / Jarvis" project (the umbrella was denied creation in Phase 1 because the auto-classifier flagged it as scope-creep · I will request approval before creating any Linear issue)
- Pre-cutover smoke test plan
- DNS plan (autonicks.com decommission · nickstire.org unchanged)
- Vercel project decommission sequence (only AFTER Railway is stable for 7+ days)

Phase 2 will not contain any code changes · plan only.

---

## 11 · Phase 1 deliverable summary

- Read both repos · 50,000-70,000 LOC nickstire · ~70,000 LOC statenour
- Inventoried 136 statenour API routes + ~30 nickstire Express routes + 65 nickstire tRPC routers
- Catalogued 88 statenour cron routes + 24 nickstire internal scheduler jobs
- Mapped 29 statenour external integrations + 14 nickstire external integrations
- Documented 7 critical decisions needed
- Surfaced 5 security findings (1 high · 4 high-medium · 1 medium)
- Established rollback anchor (`pre-migration-audit-2026-05-17` tag on nickstire `main`)
- Wrote this doc on branch `migration/audit` · NOT touching `main`

**Phase 2 cannot start until you respond with at minimum: a Path choice (A/B/C) and the SEC items confirmed.**

End of Phase 1 audit. Standing by.
