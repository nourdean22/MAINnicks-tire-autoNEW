# AGENTS.md · statenour-worker

**Last verified: 2026-08-04** — against `src/` and `package.json`, not against prose.

Cross-cutting repo rules (branching, worktrees, Windows, verify gates): root
[`AGENTS.md`](../../AGENTS.md). Deploy contract (Railway IDs, rollback, failure modes):
[`DEPLOY.md`](./DEPLOY.md).

## What this service actually is

An Express 4 + node-cron process on Railway's internal network. **Three source files** —
`src/index.ts`, `src/scheduler.ts`, `src/storage.ts`. It does two things:

1. **Forwards cron ticks** to statenour-web. It holds no business logic for those jobs: each tick is
   an authenticated `GET ${STATENOUR_WEB_URL}/api/cron/<name>` with a `Bearer CRON_SECRET`, 60s
   timeout, per-job overlap guard. Registered in `scheduler.ts`: `brain-bus-drain` (*/15m),
   `outbox-drain` (*/15m), `inngest-liveness` (daily 13:00 UTC). `POST /cron/mega` and
   `/cron/mega-evening` forward the morning/evening mega fan-out.
2. **Renders approved videos in-process** (every 2 min): polls
   `/api/sync/queue/render` for approved drafts, renders MP4 locally via `renderReelVideo` from
   `@nour/reel-engine` (Remotion), uploads through `storage.ts` (S3 + CloudFront URL or 24h presigned
   GET; local-fs fallback to `data/generated/` when `S3_BUCKET` is unset), then POSTs
   `/api/sync/queue/render-complete`. On failure the item reverts to `approved`.

**It has NO database client.** Dependencies are exactly `@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner`, `@nour/reel-engine`, `express`, `node-cron` — no `pg`, `mysql2`,
`prisma`, or `drizzle-orm`, directly or transitively. Every read and write goes over authenticated
HTTP to statenour-web. **Do not add a DB client here** — that would fork the data layer and bypass
statenour's guards. If a job needs data, it belongs behind a statenour-web route.

## Env vars the code actually reads

`PORT` · `CRON_SECRET` · `SERVICE_ROLE` · `STATENOUR_WEB_URL` · `STATENOUR_SYNC_KEY` · `AWS_REGION` ·
`S3_BUCKET` · `SITE_URL` · `CLOUDFRONT_DOMAIN`.

`DATABASE_URL` and `NICKSTIRE_DATABASE_URL` are **not read anywhere in `src/`** — `DEPLOY.md`'s
"CRITICAL" list is inherited from an earlier design. Trust this section; fix `DEPLOY.md` if you
change the contract.

## Contracts you must not weaken

- **`CRON_SECRET` is fail-closed.** `requireCronSecret` compares with `timingSafeEqual`, and the
  process refuses to boot when the secret is empty (`src/index.ts`). Never add a dev bypass, never
  fall back to string `===`.
- **`/health` reports REAL liveness** — 503 when the newest scheduler tick is more than 5 minutes
  stale. Do not make it return a static 200; Railway and the operator's cron deck read it as truth.
- **Graceful drain on SIGTERM/SIGINT** (30s bounded, 35s hard exit) — keep it, or a deploy can kill
  a render mid-write.
- `STATENOUR_SYNC_KEY` must match across statenour-web, nickstire and worker — a drift shows up as
  bridge 401s.

## Verify

```powershell
pnpm --filter @statenour/worker check    # tsc --noEmit
pnpm build:worker                        # tsc build
```

There is no test suite here. The pre-push hook covers this via `turbo run build --affected`.

## Cron job registry

The **live** registry is `GET /api/cron/list` on statenour-web, and the manifest of record is
`apps/statenour/config/crons.ts` (guarded by `pnpm check:crons`). This service only knows the three
job names hard-coded in `scheduler.ts` plus the two mega slots. Operator surface for kill-switch and
run-now: `/system/cron-deck`.
