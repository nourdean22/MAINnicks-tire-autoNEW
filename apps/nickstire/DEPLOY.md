# nickstire (MAINnicks-tire-auto) · deploy contract

**Live URL** · https://nickstire.org (Cloudflare-proxied · custom domain)

## Railway service

| Field | Value |
|---|---|
| Project | `natural-appreciation` |
| Project ID | `d78487fa-24c7-412e-9d2c-1055d9f8db93` |
| Service | `MAINnicks-tire-auto` |
| Service ID | `2c388ec9-d8f1-449c-a583-ba40cdb36b4e` |
| Environment | `production` (`84f0d4b4-efcd-480f-a761-27589e0a095f`) |
| Region | US West |
| Build context | monorepo root |
| Builder | **Nixpacks** (Railway default) · augmented by `apps/nickstire/nixpacks.toml` (adds `ffmpeg` + `fonts-dejavu-core` for server-side reel assembly) |
| Build / start | Dashboard-configured: `pnpm --filter nicks-tire-auto build` / `start` · healthcheck `/api/health` · **no Dockerfile in repo** |

## Deploy trigger

Auto-deploys on push to **`main`** of `nourdean22/MAINnicks-tire-autoNEW.git` when files
under `apps/nickstire/**` change (or workspace deps via Turbo affected detection).

Patched dependency: `wouter@3.7.1` via `apps/nickstire/patches/wouter@3.7.1.patch` ·
pnpm reapplies on every `pnpm install`.

## Pre-deploy validation (local, automatic)

The `.husky/pre-commit` hook runs the nickstire-scoped checks (brand-voice lint, source
lint, hook-after-return lint, route registry, typecheck) when nickstire files are staged.

The `.husky/pre-push` hook runs `turbo run build --affected` covering the Vite+esbuild
build + maybe-prerender step.

Manual verify:

```bash
pnpm build:nick         # Vite client + esbuild server + prerender
pnpm verify:nick        # full check suite
```

## Build pipeline

```
deps  → install pnpm@10.4.1 workspace deps · wouter patch applied
build → vite build (client) · esbuild server (ESM bundle) · scripts/build-maybe-prerender.mjs
runtime → node 20 (Nixpacks Debian base · ffmpeg + DejaVu font via nixpacks.toml) + dist/index.js (express server) + client/dist (static)
```

## Env vars (Railway-managed)

CRITICAL:
- `DATABASE_URL` · TiDB Cloud (NOT Neon · separate from statenour)
- `TWILIO_*` · SMS routing (currently SMS_KILL_SWITCH=true · F25e shop SMS gateway is primary)
- `STRIPE_*` · payment processing
- `CRON_SECRET`

Common:
- `RESEND_API_KEY` · transactional email
- `TELEGRAM_BOT_TOKEN` · ops alerts
- `VAPI_*` · voice agent (216-424-9249 · "Nick" assistant)
- `OPENAI_API_KEY` · fallback AI
- `MAKE_WEBHOOK_SECRET`
- `GOOGLE_*` · GBP integration

## Rollback

Same as statenour · Railway dashboard → service → Deployments → previous green → Redeploy.

For SMS/voice incidents specifically:

```bash
# Flip kill switch via Railway env
SMS_KILL_SWITCH=true
VAPI_KILL_SWITCH=true
```

## Common failure modes

| Symptom | Diagnosis | Fix |
|---|---|---|
| Build fails at vite step | Client-side import broken | Check `client/src/**` for missing imports |
| Build fails at esbuild | Server-side TS error | `pnpm --filter nicks-tire-auto check` locally |
| Build fails at prerender | SSR-incompatible code in pages list | Check `scripts/audit-prerender.mjs` output |
| `wouter` patch fails to apply | Lockfile drift | `rm -rf node_modules && pnpm install` |
| SMS not sending | Twilio outage OR `SMS_KILL_SWITCH=true` OR F25e offline | Telegram alert fires for F25e · check `/api/telegram/cron-status` |
| VAPI 5-day silent loss | Webhook routing config drift | See `docs/migrations/vapi-recovery.md` (canonical fix: nested `server.url`) |

## Cross-app coupling

- `apps/worker/` (statenour-worker) runs cron jobs that read nickstire DB ·
  shared `STATENOUR_SYNC_KEY` env var for signed bridge calls
- `apps/statenour/` doesn't read nickstire data directly · all bridges go through
  the worker

## Related docs

- `apps/nickstire/nixpacks.toml` · Nixpacks system-deps (ffmpeg/fonts) — **this app builds via Nixpacks, not a Dockerfile**
- `apps/nickstire/RECOVERY.md` · recovery + disaster-recovery (RPO/RTO, DB restore) procedures
- `docs/SHOP_SMS_GATEWAY_SETUP.md` · F25e SMS recovery runbook
- `docs/migrations/INDEX.md` · in-flight migrations tracker
- `apps/nickstire/CLAUDE.md` · nickstire-specific operator guide
