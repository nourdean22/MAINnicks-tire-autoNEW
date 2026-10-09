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

An Express 4 + node-cron process on Railway's internal network. **Four source files** —
`src/index.ts`, `src/scheduler.ts`, `src/storage.ts`, `src/renderPlan.ts`. It does two things:

1. **Forwards the four worker-owned cron ticks** to statenour-web. It holds no business logic for
   those jobs: each tick is an authenticated `GET ${STATENOUR_WEB_URL}/api/cron/<name>` with a
   `Bearer CRON_SECRET`, a 60s timeout and a per-job overlap guard — a slow forward skips the next
   tick instead of stacking. Registered in `scheduler.ts`: `brain-bus-drain`, `outbox-drain`,
   `inngest-liveness`, and `device-heartbeat-sentinel`.
   **There are no worker `POST /cron/mega*` entry points anymore.** Q-36 removed them after live
   Railway inspection on 2026-09-29 showed zero Railway cron services/jobs in the project and no
   cron schedule on the worker itself. Daily/weekly mega ownership lives in StateNour/Inngest.
2. **Renders approved videos in-process — every 15 minutes** (`RENDER_SCHEDULE`, `scheduler.ts:189`;
   cron registered at `:422`, tick at `:426`):
   polls `/api/sync/queue/render` for approved drafts, picks the template with `planRender`
   (`renderPlan.ts`: a customer-review video only from a declared review with a name, a 1-5 rating
   and the text; an alert as before; anything else is refused before rendering), renders MP4 locally
   via `renderReelVideo` from `@nour/reel-engine` (Remotion), uploads through `storage.ts` (S3 +
   CloudFront URL or 24h presigned GET; local-fs fallback to `data/generated/` when `S3_BUCKET` is
   unset), then POSTs `/api/sync/queue/render-complete`. **A failed or refused render is recovered
   by the render lease, not by the worker:** its "reset to approved" POST is refused (409) because
   `approveDraft` will not touch a row in `rendering`, so the row is re-claimed when its 30-minute
   lease expires and rejected after `MAX_RENDER_ATTEMPTS` (3) claims
   (`apps/statenour/app/api/sync/queue/render/route.ts`).

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

`DATABASE_URL`, `DIRECT_URL`, `GITHUB_TOKEN`, and `NICKSTIRE_DATABASE_URL` are **not read
anywhere in `src/`**. Q-36 pins that absence in
`apps/statenour/tests/repo/worker-hygiene.test.ts`. They may still exist in Railway; deleting live
variables is an operator-owned infrastructure change, not something this code branch performs.
This section is canonical: if you change the env contract, change it here first, then `DEPLOY.md`.

## Contracts you must not weaken

- **`CRON_SECRET` is fail-closed at boot.** The process refuses to start when it is empty because
  every worker-owned forward authenticates to StateNour web with `Authorization: Bearer <CRON_SECRET>`.
  The old inbound `/cron/mega*` auth middleware was deleted with those dead routes; do not restore an
  inbound secret surface just to preserve an obsolete architecture.
- **`/health` is a DUMB liveness / deploy gate — always 200 while the process serves.** It must never
  gate on scheduler state, the DB, or a downstream service (`index.ts`, `res.status(200)` is a
  literal). Railway probes this path (`.railway/railway.ts`, this service's `healthcheck`; it moved out of
  `railway.json` when that file was deleted on 2026-09-18), and a probe with restart
  authority that checks derived state turns a blip into a restart storm. Scheduler freshness rides
  in the BODY as diagnostics only.
- **`GET /health/scheduler` is the freshness signal** — 503 when the newest tick is older than
  `SCHEDULER_STALE_MS`. **Derived, never a literal**: `deriveStaleWindowMs()` (`scheduler.ts:110`,
  input `TICK_WRITING_SCHEDULES` `:195`) takes the fastest schedule that writes `lastTickAt` and
  allows two missed fires plus 5 min jitter — today `*/15` -> **35 min**. Change a cron and the
  window follows. **Never point `healthcheckPath` at this endpoint.** Safe to alert on; nothing
  restarts on it.
- **Graceful drain on SIGTERM/SIGINT** — `drainInFlight(30_000)` bounded, `35_000` hard exit
  (`index.ts:170`, `:166`, handlers at `:177-178`). Keep it, or a deploy can kill a render mid-write.
- `STATENOUR_SYNC_KEY` must match across statenour-web, nickstire and worker — a drift shows up as
  bridge 401s.

> ### ✅ RESOLVED 2026-08-21 — `/health` staleness window is now derived
>
> It was `5 * 60_000` with the comment *"a high-freq job ticks every ~2 min"*. #1696 moved the
> render loop from `*/2` to `*/15` and nothing retuned the window, so the tick floor (15 min)
> exceeded the threshold (5 min) and `/health` reported **stalled for ~10 of every 15 minutes**
> against a perfectly healthy loop.
>
> **Two things were wrong, not one.** The number was stale — fixed by deriving it from
> `TICK_WRITING_SCHEDULES`. The deeper error was putting a staleness check in the endpoint Railway
> probes at all. Note the reason, because the obvious one is the weaker one: "liveness must not check
> dependencies" is over-applied here (`lastTickAt` is an in-memory counter, and the worker-heartbeat
> pattern in the probe literature wires liveness to exactly this shape). What actually settles it is
> (a) **restart is not the repair** — a fresh process resets `lastTickAt` to 0, so killing fixes
> nothing and skips the bounded drain, and (b) **the boot grace and the gate are mutually defeating**
> — `msSinceLastTick === null` must read healthy or every restart crashloops, but a gate disarmed by
> every restart can never drive one. `/health` is now unconditionally 200; the signal moved to
> `/health/scheduler`.
>
> **The original rationale was factually false.** The old comment said 503 lets "Railway restart the
> instance". Railway's docs say it "does not monitor the healthcheck endpoint after the deployment
> has gone live" (docs.railway.com/reference/healthchecks) — the 503 could never cause a restart. It
> could only fail a DEPLOY, i.e. block shipping the fix a wedged scheduler needs. Nothing in this
> repo consumed it either (grep `msSinceLastTick` outside `apps/worker/src` -> zero), so the
> mechanism was inert for its whole life.
>
> Verified 2026-08-21 by booting the service and exercising the predicate — 7 boundary cases + 4 derivation cases, all passing: `/health` returns **200 for every**
> `msSinceLastTick`, including 6h-wedged; `/health/scheduler` returns 200 to 34.99 min and **503 at
> 35 min** and beyond. Restart cannot perpetuate staleness — a fresh process resets `lastTickAt` to
> 0, so `msSinceLastTick` is `null` and both read fresh. Derivation adapts: `*/2` -> 9 min,
> `*/5`+`*/15` -> 15 min, daily-only -> 2,885 min, unparsable -> 60 min floor.

## Verify

```powershell
pnpm --filter @statenour/worker check    # tsc --noEmit
pnpm build:worker                        # tsc build
```

There is no test suite here. The pre-push hook covers this via `turbo run build --affected`. Say
exactly that in a receipt — an unqualified "verified" reads as a test pass that never happened.

## Cron job registry

The **live** catalog is `/system/crons` on statenour-web (tRPC `systemAutomation.cronDeck`,
manifest-backed). The manifest of record is `apps/statenour/config/crons.ts` (guarded by
`pnpm check:crons`). This worker only knows the four job names hard-coded in `scheduler.ts`;
morning/evening mega fan-out is not worker-owned. Operator surface for kill-switch and run-now:
`/system/crons`.

<!--
  2026-08-21: this section said `GET /api/cron/list` and `/system/cron-deck`. Neither exists —
  a search of app/api/cron for `list`, and for `cron-deck` anywhere under app/, both return zero.
  The same wrong pair rode in apps/worker/DEPLOY.md until 2026-09-23 (Q-30). Corrected against
  app/api/settings/crons/route.ts:1-3 and app/(mastery)/system/crons/page.tsx:4.
-->
