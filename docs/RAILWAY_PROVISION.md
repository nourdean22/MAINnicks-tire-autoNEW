# Railway provisioning · operator handoff · CP6 + CP7

> **Where we are**: CP1-CP5 shipped on branch `migration/merge-statenour`.
> Branch is ready to deploy. This doc walks you through the Railway
> dashboard clicks for CP6 (provision services) + CP7 (provision crons).
> CP8-CP10 are also operator-driven · they come after CP6+CP7 are green.

---

## State of play

| Service to provision | Source | Status |
|---|---|---|
| `nickstire-web` | Already exists on Railway · just needs its **Root Directory** repointed | Existing |
| `statenour-web` | NEW Railway service · Dockerfile at `apps/statenour/Dockerfile` | Needs creation |
| `statenour-worker` | NEW Railway service · Dockerfile at `apps/worker/Dockerfile` | Needs creation |
| Railway cron `mega-morning` | NEW cron job · hits worker's `/cron/mega` | Needs creation |
| Railway cron `mega-evening` | NEW cron job · hits worker's `/cron/mega-evening` | Needs creation |

The branch `migration/merge-statenour` has NOT been merged to `main` yet.
**Do not merge until CP6-CP7 are green.** Provision the new services from
the branch first, prove they work, then merge.

---

## STEP 0 · Generate a strong CRON_SECRET

Run locally · save the output somewhere safe (you'll paste it into Railway):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

This becomes `CRON_SECRET` (used by Railway cron HTTP triggers) and
`WORKER_SHARED_SECRET` (if web ever calls worker directly · not used in CP6).

---

## STEP 1 · Update nickstire-web service in Railway

Existing nickstire service was building from repo root. After the
monorepo move (CP2), nickstire lives in `apps/nickstire/`. Update:

1. Open Railway dashboard → `MAINnicks-tire-autoNEW` project → `nickstire-web` service
2. **Settings → Service**
   - Root Directory: `apps/nickstire`
   - Watch Paths: `apps/nickstire/**`
3. **Settings → Deploy**
   - Build Command: `corepack enable && pnpm install --frozen-lockfile --filter nicks-tire-auto && pnpm --filter nicks-tire-auto build`
   - Start Command: `pnpm --filter nicks-tire-auto start`
   - Healthcheck Path: `/api/health` (unchanged)
4. **DO NOT redeploy yet** · finish provisioning everything first, then
   point the production domain at the new build only when CP9 cuts over.

---

## STEP 2 · Create statenour-web service

1. Railway dashboard → `MAINnicks-tire-autoNEW` project → **+ New Service**
2. **Source**: Deploy from GitHub repo · pick `nourdean22/MAINnicks-tire-autoNEW`
3. **Branch**: `migration/merge-statenour` (for now · will swap to `main` after CP9 merge)
4. **Settings → Service**
   - Service name: `statenour-web`
   - Root Directory: `apps/statenour`
   - Watch Paths: `apps/statenour/**`
5. **Settings → Build**
   - Builder: **Dockerfile**
   - Dockerfile Path: `apps/statenour/Dockerfile`
   - Build Context: `.` (monorepo root · important · the Dockerfile expects
     the build context to be the root so workspace deps resolve)
6. **Settings → Deploy**
   - Start Command: (leave empty · Dockerfile CMD takes over)
   - Healthcheck Path: `/api/system/health`
   - Healthcheck Timeout: 30s
   - Restart Policy: Always
7. **Settings → Networking**
   - **DO NOT** add a custom domain yet
   - Generate a Railway domain (free `*.up.railway.app` · this becomes
     `statenour-admin.up.railway.app` per the plan)
8. **Settings → Resources**
   - RAM: 512 MB (raise if cold-start OOMs)
9. **Settings → Environment Variables** · click "Raw Editor" · paste:

```
NODE_ENV=production
SERVICE_ROLE=web
PORT=8080
APP_BASE_URL=https://<your-new-railway-domain>

# DB (copy current values from Vercel statenour env)
DATABASE_URL=<your Neon pooled URL>
DIRECT_URL=<your Neon direct URL>

# Auth (NextAuth)
AUTH_SECRET=<random 64+ char hex>
AUTH_GOOGLE_CLIENT_ID=<from Google Cloud Console>
AUTH_GOOGLE_CLIENT_SECRET=<from Google Cloud Console>

# Cron auth (same value as worker · used if web ever fires its own crons)
CRON_SECRET=<the value from STEP 0>

# AI providers (shared with worker · use Railway Shared Variables for these)
VENICE_API_KEY=<copy from Vercel>
ANTHROPIC_API_KEY=<copy from Vercel>
ANTHROPIC_MODEL=<copy from Vercel>
OPENAI_API_KEY=<copy from Vercel>
OPENAI_MODEL=<copy from Vercel>
GOOGLE_GENERATIVE_AI_API_KEY=<copy from Vercel>
XAI_API_KEY=<copy from Vercel>
HUGGINGFACE_API_KEY=<copy from Vercel>
PERPLEXITY_API_KEY=<copy from Vercel>
COHERE_API_KEY=<copy from Vercel>
EXA_API_KEY=<copy from Vercel>
TAVILY_API_KEY=<copy from Vercel>
E2B_API_KEY=<copy from Vercel>

# Email + notif
RESEND_API_KEY=<copy from Vercel>
TELEGRAM_BOT_TOKEN=<copy from Vercel>
TELEGRAM_CHAT_ID=<copy from Vercel>
TELEGRAM_WEBHOOK_SECRET=<copy from Vercel>

# Web Push
VAPID_PUBLIC_KEY=<copy from Vercel>
VAPID_PRIVATE_KEY=<copy from Vercel>
VAPID_SUBJECT=<copy from Vercel · or mailto:nourdean22@gmail.com>

# SMS
TWILIO_ACCOUNT_SID=<copy from Vercel>
TWILIO_AUTH_TOKEN=<copy from Vercel>
TWILIO_PHONE_NUMBER=<copy from Vercel>

# Google API surface
GOOGLE_SERVICE_ACCOUNT_KEY=<copy from Vercel · full PEM>
GOOGLE_PLACES_API_KEY=<copy from Vercel>
GOOGLE_PLACE_ID=<copy from Vercel>
GMAIL_REFRESH_TOKEN=<copy from Vercel>

# Voice
VAPI_WEBHOOK_SECRET=<copy from Vercel>
VIDEO_DB_API_KEY=<copy from Vercel>

# Integrations
APOLLO_API_KEY=<copy from Vercel>
CLICKUP_API_KEY=<copy from Vercel>
CLICKUP_DEFAULT_LIST_ID=<copy from Vercel>
FIREFLIES_API_KEY=<copy from Vercel>
MAKE_WEBHOOK_URL=<copy from Vercel>
MAKE_WEBHOOK_SECRET=<copy from Vercel>
MAKE_WEBHOOK_API_KEY=<copy from Vercel>
BROWSERBASE_API_KEY=<copy from Vercel>
BROWSERBASE_PROJECT_ID=<copy from Vercel>
META_PAGE_ACCESS_TOKEN=<copy from Vercel>
META_IG_USER_ID=<copy from Vercel>
META_PAGE_ID=<copy from Vercel>
GITHUB_TOKEN=<copy from Vercel>
OPENWEATHER_API_KEY=<copy from Vercel>
OPENWEATHER_CITY=<copy from Vercel>

# Statenour ↔ nickstire bridge (existing contract, unchanged)
NICKSTIRE_URL=https://nickstire.org
BRIDGE_API_KEY=<existing value>
STATENOUR_SYNC_KEY=<existing value>

# Runner agent (required since Wave 49 · non-empty mandatory)
RUNNER_SHARED_SECRET=<existing value · NOT EMPTY>

# Optional · only if you provisioned Redis on Railway
# REDIS_URL=<Railway Redis service URL>
# REDIS_KEY_PREFIX=statenour:
```

10. Click **Deploy** · watch the build log · expect ~5-8 min for first build (Docker layer cache empty)
11. When the deploy turns green: `curl https://<your-new-railway-domain>/api/system/health` · should return JSON with `ok: true`

---

## STEP 3 · Create statenour-worker service

1. Railway dashboard → same project → **+ New Service**
2. **Source**: Same GitHub repo · branch `migration/merge-statenour`
3. **Settings → Service**
   - Service name: `statenour-worker`
   - Root Directory: `apps/worker`
   - Watch Paths: `apps/worker/**` + `apps/statenour/lib/**` (worker imports from statenour lib in CP6 wiring)
4. **Settings → Build**
   - Builder: **Dockerfile**
   - Dockerfile Path: `apps/worker/Dockerfile`
   - Build Context: `.` (monorepo root · same reason)
5. **Settings → Deploy**
   - Healthcheck Path: `/health`
   - Restart Policy: Always
6. **Settings → Networking**
   - **DO NOT** add a public domain · worker is internal-only
   - Note the Railway internal hostname · it looks like
     `statenour-worker.railway.internal` · you'll paste this into the
     cron triggers in STEP 4
7. **Settings → Resources**
   - RAM: 1024 MB (worker is the cost driver · LLM concurrency needs headroom)
8. **Settings → Environment Variables** · paste:

```
NODE_ENV=production
SERVICE_ROLE=worker
PORT=8080

# Cron auth (REQUIRED · fail-closed if empty per Wave 49 hardening)
CRON_SECRET=<the value from STEP 0 · same as web>

# DB (same Neon, separate connection pool)
DATABASE_URL=<same as statenour-web>
DIRECT_URL=<same as statenour-web>

# AI providers (shared with web · use Railway Shared Variables)
VENICE_API_KEY=<same>
ANTHROPIC_API_KEY=<same>
ANTHROPIC_MODEL=<same>
OPENAI_API_KEY=<same>
OPENAI_MODEL=<same>
GOOGLE_GENERATIVE_AI_API_KEY=<same>
HUGGINGFACE_API_KEY=<same>
PERPLEXITY_API_KEY=<same>
COHERE_API_KEY=<same>
EXA_API_KEY=<same>
TAVILY_API_KEY=<same>
E2B_API_KEY=<same>

# Email + notif (worker fires Telegram alerts)
RESEND_API_KEY=<same>
TELEGRAM_BOT_TOKEN=<same>
TELEGRAM_CHAT_ID=<same>

# Calendar (worker calendar-premeeting cron needs this)
GOOGLE_SERVICE_ACCOUNT_KEY=<same>

# Optional integrations the worker uses
APOLLO_API_KEY=<same>
FIREFLIES_API_KEY=<same>
BROWSERBASE_API_KEY=<same>
BROWSERBASE_PROJECT_ID=<same>

# CP6 wiring · MUST be set · worker forwards cron ticks to statenour-web
# via this internal Railway hostname. Paste the EXACT internal hostname
# Railway assigns to statenour-web (under that service's Settings →
# Networking → Service Domain). If left empty, the worker logs the
# tick + does nothing else (graceful degrade, but no work happens).
STATENOUR_WEB_URL=https://<statenour-web-internal-hostname>
```

9. **Deploy** · watch the build · ~2 min for first build
10. When green: `curl https://<worker-railway-domain>/health` · should return `{ "ok": true, "role": "worker", "scheduler": "running" }`
11. Note: the worker's first deploy will show stub log lines from the scheduler · CP6 wiring (replacing stubs with real cron handlers) is the next milestone

---

## STEP 4 · Provision Railway cron jobs

Railway has a built-in cron scheduler. Add two jobs:

### 4a · mega-morning

1. Railway dashboard → project → **+ New Service** → **Cron Job**
2. Name: `mega-morning`
3. Schedule (UTC): `0 9 * * *`  (= 5am ET morning)
4. Command type: **HTTP Request**
5. URL: `https://<your-worker-railway-internal-hostname>/cron/mega`
6. Method: `POST`
7. Headers (one per line):
   ```
   Authorization: Bearer <the CRON_SECRET value from STEP 0>
   Content-Type: application/json
   ```
8. Save

### 4b · mega-evening

Same as above but:
- Name: `mega-evening`
- Schedule (UTC): `0 2 * * *`  (= 10pm ET evening prior)
- URL: `https://<worker-hostname>/cron/mega-evening`

### 4c · manual smoke test

In Railway UI: click each cron job → **Run Now**. Expected behavior:
- Worker logs show `[worker] /cron/mega triggered at <timestamp>`
- HTTP response: `{"ok": true, "slot": "morning", "deferred": "wire-in-CP6"}` (the stub)
- The actual fan-out wiring is the next checkpoint after CP7

---

## STEP 5 · Smoke verification (do this before reporting back)

```bash
# 1. statenour-web is alive
curl -i https://<statenour-web-domain>/api/system/health
# → 200 OK · JSON with { ok: true, ... }

# 2. worker is alive
curl -i https://<worker-domain>/health
# → 200 OK · { ok: true, role: "worker", scheduler: "running" }

# 3. worker scheduler is ticking
# Open Railway logs for statenour-worker
# Within 2 min you should see lines like:
#   [scheduler] tick · 2026-05-17T... · brain-bus-backfill · ...
# This proves the in-process node-cron loop is running.

# 4. statenour-web admin loads
# Visit https://<statenour-web-domain>/system/cockpit in your browser
# Sign in with Google · cockpit should render with cards
```

---

## STEP 6 · Report back to me

When STEP 5 is green, paste back:
1. The Railway domains for `statenour-web` and `statenour-worker`
2. Confirmation `/api/system/health` returns 200
3. Confirmation `/health` on worker returns 200
4. Confirmation you see scheduler tick logs

Then I'll start CP8 (dual-write window setup · we let Railway + Vercel run side-by-side 48-72h to compare behavior before cutover).

---

## What if something breaks

- **statenour-web build fails on Dockerfile**: check Railway "Build Context" is set to `.` (monorepo root), not `apps/statenour`. The Dockerfile expects to see all 3 workspace `package.json`s to install in deps stage.
- **worker won't start · "refusing to start"**: that's the Wave 49 hardening · means `CRON_SECRET` env is empty. Set it.
- **Health check times out**: bump healthcheck timeout in Railway service settings to 60s for first cold start.
- **Build OOMs**: raise the build resources in Railway (Settings → Resources). Default 2GB should be fine but Next.js + Prisma can spike.
- **Anything weird about the bridge** (`/api/bridge/*`): leave it alone · the existing nickstire bridge contract is unchanged · those keys (`STATENOUR_SYNC_KEY` + `BRIDGE_API_KEY`) keep working.

---

## What I (Claude) will do next (CP6 internal wiring)

While you're clicking through Railway, I can ship CP6 wiring on the same branch in parallel:
- Replace worker scheduler stub log lines with actual statenour cron handler calls
- Decide whether worker imports handlers in-process (zero HTTP overhead) or fires HTTP to `statenour-web.railway.internal/api/cron/<name>` (preserves Vercel-era contract exactly)
- That's a code change · happens on `migration/merge-statenour` · ships before you do CP8/CP9
