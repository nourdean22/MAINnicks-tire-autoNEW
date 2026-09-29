# statenour-worker · deploy contract

**Role** · secret-gated cron tick dispatcher + in-process Remotion render loop for statenour-web. No DB client — every read/write goes over authenticated HTTP (see `AGENTS.md`).

## Railway service

| Field | Value |
|---|---|
| Project | `natural-appreciation` |
| Project ID | `d78487fa-24c7-412e-9d2c-1055d9f8db93` |
| Service | `statenour-worker` |
| Service ID | `5441c378-3bab-4bb7-958f-36961159f5fe` |
| Environment | `production` (`84f0d4b4-efcd-480f-a761-27589e0a095f`) |
| Region | `us-east4-eqdc4a` · 1 replica (live Railway read-back 2026-09-29) |
| Public URL | none (live Railway domain list 2026-09-29 returned no service/custom domains) |
| Build context | monorepo root |
| Dockerfile | `apps/worker/Dockerfile` (`.railway/railway.ts:85`) |

## Deploy trigger

Auto-deploys on push to **`main`** when a watched path changes. The watch list is `.railway/railway.ts:85`, the only
build/deploy config in the repo: `apps/worker/**` minus this file, `AGENTS.md` and `CLAUDE.md`, plus
`apps/statenour/lib/**`, `packages/reel-engine/**`, `apps/nickstire/patches/**` and the root workspace files.
Deploys do not wait for CI (`checkSuites: false`, same line).

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
- `STATENOUR_WEB_URL` · base URL every tick is forwarded to. Production uses Railway private
  networking at `http://statenour-web.railway.internal:8080`; the worker itself has no public
  domain. This keeps worker→web traffic off the public edge and colocates both services in east4.

USED:
- `PORT` · listener (default 8080) · `SERVICE_ROLE`
- `STATENOUR_SYNC_KEY` · signed bridge calls — must match statenour-web AND nickstire
- `AWS_REGION`, `S3_BUCKET`, `CLOUDFRONT_DOMAIN`, `SITE_URL` · video-render upload path; with
  `S3_BUCKET` unset, renders fall back to local `data/generated/`

NOT read by this service: `DATABASE_URL`, `DIRECT_URL`, `GITHUB_TOKEN`,
`NICKSTIRE_DATABASE_URL`, `OPENAI_API_KEY`, `VENICE_API_KEY`, `TELEGRAM_BOT_TOKEN`.
Q-36 pins the first three high-risk absences in an executable repo test. They may still be set on
the Railway service; removing live variables is an explicit operator infrastructure action.

## Cron jobs

The worker **forwards ticks**; the jobs themselves execute as statenour-web route handlers.
Live catalog: `/system/crons` on statenour-web (tRPC `systemAutomation.cronDeck`, built from the manifest by
`buildCronCommandDeck`); manifest of record: `apps/statenour/config/crons.ts` (guarded by `pnpm check:crons`).
Do not read `GET /api/settings/crons` as the catalog: it parses the deleted `vercel.json`
(`lib/services/cron-control.ts` `listScheduledCrons`), so it returns only its hard-coded mega rows.

Registered here in `src/scheduler.ts`:
- `brain-bus-drain` · every 15m → GET `/api/cron/brain-bus-drain`
- `outbox-drain` · every 15m → GET `/api/cron/outbox-drain`
- `inngest-liveness` · daily 13:00 UTC → GET `/api/cron/inngest-liveness`
- `device-heartbeat-sentinel` · every 15m → GET `/api/cron/device-heartbeat-sentinel`

Q-36 removed the vestigial worker `POST /cron/mega*` routes. Live Railway read-back on
2026-09-29 showed exactly four services (Nick's, StateNour web, StateNour worker, Redis), no cron
services/jobs, and no cron schedule on the worker. Morning/evening mega fan-out is therefore not a
worker HTTP-entry-point responsibility.

Plus one job that runs **in-process** rather than forwarding: a 15-minute video-render loop (`*/2` until #1696) that
polls `/api/sync/queue/render`, renders MP4 via `@nour/reel-engine` (Remotion), uploads through
`src/storage.ts`, and POSTs `/api/sync/queue/render-complete` (reverting the item to `approved` on
failure).

Operator surface: `/system/crons` (kill switch · run-now · per-job status).

## Rollback

Same as other services · Railway dashboard → Deployments → previous green → Redeploy.

If a cron is causing problems, kill via `/system/crons` BEFORE rolling back the
service · prevents the rollback from re-triggering the bad cron immediately.

## Common failure modes

| Symptom | Diagnosis | Fix |
|---|---|---|
| Worker crash loop | Unhandled promise rejection in a tick or the render loop | Check Railway logs · identify the failing job and add the missing catch |
| Cron silently stopped | Service replica count 0 OR the job's kill switch is off | Check Railway replica + `/system/crons` |
| Nickstire bridge 401 | `STATENOUR_SYNC_KEY` drift between services | Sync the env var across statenour-web + nickstire + worker (all 3 must match) |

## Related docs

- [`apps/worker/AGENTS.md`](./AGENTS.md) · what this service actually is (verified against `src/`)
- `apps/worker/src/{index,scheduler,storage}.ts` · the entire implementation — there is no
  `src/cron/` directory
- `apps/statenour/config/crons.ts` · cron manifest of record (`pnpm check:crons`)
