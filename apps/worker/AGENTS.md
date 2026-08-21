# AGENTS.md · statenour-worker

**Every claim below cites `file:line`. If a citation does not match the code, the DOC is wrong — fix
the doc, do not "restore" the documented value.** This file carries no self-verified date stamp on
purpose.

<!--
  2026-08-21 AUDIT. The stamp this replaces ("Last verified: 2026-08-04 — against src/ and
  package.json") outlived its subject: src/ last moved in d8675b42b (2026-08-19, #1696) while this
  file had exactly one commit ever (69513533f, 2026-08-04). Nothing recomputed the stamp, so it
  advertised trustworthiness precisely where a fact had gone stale — the render cadence, which
  #1696 changed from */2 to */15 and this doc still called "every 2 min" until today.
  A date stamp decays silently; a file:line citation decays loudly the moment someone follows it.
  If you want a stamp back, make it machine-checked first.
-->

Cross-cutting repo rules (branching, worktrees, Windows, verify gates): root
[`AGENTS.md`](../../AGENTS.md). Deploy contract (Railway IDs, rollback, failure modes):
[`DEPLOY.md`](./DEPLOY.md).

## What this service actually is

An Express 4 + node-cron process on Railway's internal network. **Three source files** —
`src/index.ts`, `src/scheduler.ts`, `src/storage.ts`. It does two things:

1. **Forwards cron ticks** to statenour-web. It holds no business logic for those jobs: each tick is
   an authenticated `GET ${STATENOUR_WEB_URL}/api/cron/<name>` with a `Bearer CRON_SECRET`, a 60s
   timeout (`scheduler.ts:37` `FORWARD_TIMEOUT_MS = 60_000`) and a per-job overlap guard
   (`scheduler.ts:46` `inFlightForwards`, checked at `:301` — a slow forward skips the next tick
   instead of stacking). Registered in `scheduler.ts`: `brain-bus-drain` (`:73` `*/15 * * * *`),
   `outbox-drain` (`:82` `*/15 * * * *`), `inngest-liveness` (`:95` `0 13 * * *`, daily 13:00 UTC).
   `POST /cron/mega` (`index.ts:106`) and `/cron/mega-evening` (`index.ts:112`) forward the
   morning/evening mega fan-out.
2. **Renders approved videos in-process — every 15 minutes** (`scheduler.ts:334` `*/15 * * * *`):
   polls `/api/sync/queue/render` for approved drafts, renders MP4 locally via `renderReelVideo`
   from `@nour/reel-engine` (Remotion), uploads through `storage.ts` (S3 + CloudFront URL or 24h
   presigned GET; local-fs fallback to `data/generated/` when `S3_BUCKET` is unset), then POSTs
   `/api/sync/queue/render-complete`. On failure the item reverts to `approved`.

   > **Cadence changed 2026-08-19 (#1696, `d8675b42b`)** from `*/2` to `*/15` — *"stop the 2-min
   > render poll pinning Neon awake."* A queued reel now waits up to ~13 minutes longer to start.

**It has NO database client.** Dependencies are exactly `@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner`, `@nour/reel-engine`, `express`, `node-cron` — no `pg`, `mysql2`,
`prisma`, or `drizzle-orm`, directly or transitively. Every read and write goes over authenticated
HTTP to statenour-web. **Do not add a DB client here** — that would fork the data layer and bypass
statenour's guards. If a job needs data, it belongs behind a statenour-web route.

## Env vars the code actually reads

`PORT` · `CRON_SECRET` · `SERVICE_ROLE` · `STATENOUR_WEB_URL` · `STATENOUR_SYNC_KEY` · `AWS_REGION` ·
`S3_BUCKET` · `SITE_URL` · `CLOUDFRONT_DOMAIN`.

`DATABASE_URL` and `NICKSTIRE_DATABASE_URL` are **not read anywhere in `src/`**. This section is
canonical: if you change the env contract, change it here first, then `DEPLOY.md`.

## Contracts you must not weaken

- **`CRON_SECRET` is fail-closed.** `requireCronSecret` (`index.ts:52`) compares with
  `timingSafeEqual` (imported at `index.ts:25`), and the process refuses to boot when the secret is
  empty — `process.exit(1)` at `index.ts:47`, rationale at `:37-39` (an empty secret would compare
  equal and bypass auth). Never add a dev bypass, never fall back to
  string `===`.
- **`/health` reports REAL liveness** — 503 when the newest scheduler tick is older than
  `SCHEDULER_STALE_MS` (`index.ts:73`, currently `5 * 60_000`; compared at `:77`, served at `:78`).
  Do not make it return a static 200; Railway and the operator's cron deck read it as truth.
- **Graceful drain on SIGTERM/SIGINT** — `drainInFlight(30_000)` bounded, `35_000` hard exit
  (`index.ts:143`, `:147`, handlers at `:154-155`). Keep it, or a deploy can kill a render mid-write.
- `STATENOUR_SYNC_KEY` must match across statenour-web, nickstire and worker — a drift shows up as
  bridge 401s.

> ### ⚠ OPEN BUG — `/health` staleness window is mistuned against the current cadence
>
> `SCHEDULER_STALE_MS` is **5 minutes** (`index.ts:73`) and its own comment still reads
> *"a high-freq job ticks every ~2 min"*. Since #1696 **no job ticks faster than 15 minutes** —
> every schedule in `scheduler.ts` is `*/15 * * * *` or daily (`:73`, `:82`, `:95`, `:334`), and
> `lastTickAt` is written only at `:306` and `:336`.
>
> So `msSinceLastTick` exceeds the 5-minute window for roughly **10 of every 15 minutes**, and
> `/health` should be returning **503 about two-thirds of the time** — which Railway reads as an
> unhealthy instance.
>
> **Not fixed here** (this file is documentation; that is a code change). The fix is to retune
> `SCHEDULER_STALE_MS` to the real cadence — e.g. `20 * 60_000`, giving one missed `*/15` tick of
> slack — or to add a genuine high-frequency heartbeat tick. **Verify against the live
> `/health` before acting**; production evidence outranks this file.

## Verify

```powershell
pnpm --filter @statenour/worker check    # tsc --noEmit
pnpm build:worker                        # tsc build
```

There is no test suite here. The pre-push hook covers this via `turbo run build --affected`. Say
exactly that in a receipt — an unqualified "verified" reads as a test pass that never happened.

## Cron job registry

The **live** catalog is `GET /api/settings/crons` on statenour-web (`PATCH` toggles a job,
`POST /api/settings/crons/trigger` fires one), and the manifest of record is
`apps/statenour/config/crons.ts` (guarded by `pnpm check:crons`). This service only knows the three
job names hard-coded in `scheduler.ts` plus the two mega slots. Operator surface for kill-switch and
run-now: `/system/crons`.

<!--
  2026-08-21: this section said `GET /api/cron/list` and `/system/cron-deck`. Neither exists —
  a search of app/api/cron for `list`, and for `cron-deck` anywhere under app/, both return zero.
  The same wrong pair still rides in apps/worker/DEPLOY.md:65. Corrected against
  app/api/settings/crons/route.ts:1-3 and app/(mastery)/system/crons/page.tsx:4.
-->
