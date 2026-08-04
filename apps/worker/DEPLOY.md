# statenour-worker · deploy contract

**Role** · secret-gated cron tick dispatcher + in-process Remotion render loop for statenour-web. No DB client — every read/write goes over authenticated HTTP (see `AGENTS.md`).

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
runtime → node 24 + dist/index.js + node-cron schedules
```

## Env vars (Railway-managed)

> **Corrected 2026-08-04** against `src/`. This service has **no database client** and reads no
> `DATABASE_URL`. The previous "CRITICAL" list described an earlier design in which the worker
> talked to Neon and TiDB directly; it never shipped that way. Canonical contract:
> [`AGENTS.md`](./AGENTS.md).

REQUIRED (the process refuses to boot or silently no-ops without these):
- `CRON_SECRET` · Bearer secret for `/cron/*`, compared with `timingSafeEqual`; **fail-closed** —
  the server refuses to start when it is empty
- `STATENOUR_WEB_URL` · internal base URL every tick is forwarded to

USED:
- `PORT` · listener (default 8080) · `SERVICE_ROLE`
- `STATENOUR_SYNC_KEY` · signed bridge calls — must match statenour-web AND nickstire
- `AWS_REGION`, `S3_BUCKET`, `CLOUDFRONT_DOMAIN`, `SITE_URL` · video-render upload path; with
  `S3_BUCKET` unset, renders fall back to local `data/generated/`

NOT read by this service: `DATABASE_URL`, `NICKSTIRE_DATABASE_URL`, `OPENAI_API_KEY`,
`VENICE_API_KEY`, `TELEGRAM_BOT_TOKEN`. They may still be set on the Railway service; the code
ignores them.

## Cron jobs

The worker **forwards ticks**; the jobs themselves execute as statenour-web route handlers.
Live registry: GET `/api/cron/list` on statenour-web; manifest of record:
`apps/statenour/config/crons.ts` (guarded by `pnpm check:crons`).

Registered here in `src/scheduler.ts`:
- `brain-bus-drain` · every 15m → GET `/api/cron/brain-bus-drain`
- `outbox-drain` · every 15m → GET `/api/cron/outbox-drain`
- `inngest-liveness` · daily 13:00 UTC → GET `/api/cron/inngest-liveness`
- `POST /cron/mega` and `/cron/mega-evening` → `/api/cron/mega?slot=morning|evening`

Plus one job that runs **in-process** rather than forwarding: a 2-minute video-render loop that
polls `/api/sync/queue/render`, renders MP4 via `@nour/reel-engine` (Remotion), uploads through
`src/storage.ts`, and POSTs `/api/sync/queue/render-complete` (reverting the item to `approved` on
failure).

Operator surface: `/system/cron-deck` (kill switch · run-now · per-job status).

## Rollback

Same as other services · Railway dashboard → Deployments → previous green → Redeploy.

If a cron is causing problems, kill via `/system/cron-deck` BEFORE rolling back the
service · prevents the rollback from re-triggering the bad cron immediately.

## Common failure modes

| Symptom | Diagnosis | Fix |
|---|---|---|
| Worker crash loop | Unhandled promise rejection in a tick or the render loop | Check Railway logs · identify the failing job and add the missing catch |
| Cron silently stopped | Service replica count 0 OR `CRON_KILL_SWITCH=true` | Check Railway replica + `/system/cron-deck` |
| Nickstire bridge 401 | `STATENOUR_SYNC_KEY` drift between services | Sync the env var across statenour-web + nickstire + worker (all 3 must match) |

## Related docs

- [`apps/worker/AGENTS.md`](./AGENTS.md) · what this service actually is (verified against `src/`)
- `apps/worker/src/{index,scheduler,storage}.ts` · the entire implementation — there is no
  `src/cron/` directory
- `apps/statenour/config/crons.ts` · cron manifest of record (`pnpm check:crons`)
