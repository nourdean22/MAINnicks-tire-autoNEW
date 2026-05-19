# statenour-worker · deploy contract

**Role** · long-running cron + bridge between statenour-web and nickstire.

## Railway service

| Field | Value |
|---|---|
| Project | `natural-appreciation` |
| Project ID | `d78487fa-24c7-412e-9d2c-1055d9f8db93` |
| Service | `statenour-worker` |
| Service ID | `e70db361-4a30-45e9-b869-327845817531` |
| Environment | `production` (`84f0d4b4-efcd-480f-a761-27589e0a095f`) |
| Region | US West |
| Public URL | `statenour-worker-production.up.railway.app` (private API only · not user-facing) |
| Build context | monorepo root |
| Dockerfile | `apps/worker/Dockerfile` (or root if collocated) |

## Deploy trigger

Auto-deploys on push to **`main`** when files under `apps/worker/**` change.

## Pre-deploy validation

```bash
pnpm --filter @statenour/worker check    # tsc --noEmit
pnpm build:worker                         # tsc build
```

The pre-push hook covers this via `turbo run build --affected`.

## Build pipeline

```
deps  → install pnpm@10.4.1 workspace deps
build → tsc -p tsconfig.json · emit dist/
runtime → node 20 + dist/index.js + node-cron schedules
```

## Env vars (Railway-managed)

CRITICAL:
- `DATABASE_URL` · Neon Postgres (shared with statenour-web)
- `NICKSTIRE_DATABASE_URL` · TiDB Cloud (cross-app reads)
- `STATENOUR_SYNC_KEY` · HMAC for signed bridge calls
- `CRON_SECRET`

Common:
- `OPENAI_API_KEY` · for AI-driven cron jobs (drift detection, etc)
- `VENICE_API_KEY` · fallback provider
- `TELEGRAM_BOT_TOKEN` · ops alerts

## Cron jobs hosted here

Live registry: GET `/api/cron/list` on statenour-web. Examples:
- `nightly-drift-scan` · 02:00 UTC
- `mastery-score-refresh` · every 6h
- `nickstire-bridge-sync` · every 30m (reads TiDB → writes Neon snapshot)

Operator surface: `/system/cron-deck` (kill switch · run-now · per-job status).

## Rollback

Same as other services · Railway dashboard → Deployments → previous green → Redeploy.

If a cron is causing problems, kill via `/system/cron-deck` BEFORE rolling back the
service · prevents the rollback from re-triggering the bad cron immediately.

## Common failure modes

| Symptom | Diagnosis | Fix |
|---|---|---|
| Worker crash loop | Unhandled promise rejection in a cron job | Check Railway logs · most jobs use `withGuardian` wrapper · find the one that doesn't |
| Cron silently stopped | Service replica count 0 OR `CRON_KILL_SWITCH=true` | Check Railway replica + `/system/cron-deck` |
| Nickstire bridge 401 | `STATENOUR_SYNC_KEY` drift between services | Sync the env var across statenour-web + nickstire + worker (all 3 must match) |

## Related docs

- `apps/worker/src/cron/**` · job definitions
- `apps/statenour/lib/cron/registry.ts` · cron registry used by /system/cron-deck
