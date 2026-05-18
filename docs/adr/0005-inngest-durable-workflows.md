# ADR-0005 · Inngest as the durable workflow control plane

> **Status**: Accepted (2026-05-17 · Wave-200 Phase 3)
> **Decision drivers**: per-step checkpointing · operator-grade observability · low cost · no vendor lock-in beyond a thin SDK boundary

---

## Context

statenour-web's background work today runs as raw cron HTTP fan-outs:

- `/api/cron/mega?slot=morning` and `?slot=evening` each fan out to
  20-35 child cron URLs via `Promise.all` (with `withConcurrency(6)`
  added in v10.0.195 after the AI provider thundering herd incident)
- Each child cron writes a `CronJobLog` row · the parent writes one
  too · diagnostics surface drift via these rows
- Failures inside a fan-out are SWALLOWED — the parent returns
  `status: 'partial'` and the operator has to grep `cronJobLog.error`
  text to see which child died · no per-step retry · no replay

Three pain points this creates:

1. **No per-step retry on transient failures.** When the AI provider
   chain has a 30-second rate-limit blip, every child cron that fires
   during the blip just records "failed". Today's fan-out has no
   primitive for "retry just the failed child in 60 seconds".
2. **No replay surface.** When the operator reads the dashboard at
   `/system/crons` and sees an evening fan-out at 80% success, the
   only recovery is to manually `curl` each of the 6 failed children.
   There's no "rerun the failed ones" button.
3. **No `step.waitForEvent`.** Long-running operator workflows that
   need confirmation ("Telegram me before sending these 5 SMS · wait
   for approval · then send") are impossible to express without
   building a custom state machine over `BrainMemory`. The few that
   exist (e.g. revenue-decision) hand-roll this.

Wave-200 Phase 3 introduces a durable workflow control plane to fix
all three. We need: the platform stores per-step results · retries
failures · pauses for external events · gives us a dashboard. We
do NOT need: another database · another auth boundary · another
runtime to deploy and monitor.

## Decision

**Adopt Inngest.** Single thin SDK boundary · functions run inside
the existing Next.js process via a serve endpoint at `/api/inngest` ·
the Inngest cloud handles scheduling + checkpointing + retry +
dashboard. Our work stays in our codebase; the platform manages the
event loop.

### What ships in Phase 3

- `inngest@4.4.0` SDK added to `apps/statenour/`
- `apps/statenour/src/inngest/client.ts` · lazy singleton Inngest
  client + `isInngestFullyConfigured()` predicate for graceful degrade
- `apps/statenour/src/inngest/functions/mega-fanout.ts` · Inngest
  re-implementation of the morning + evening cron fan-out. Each child
  cron is a `step.run` checkpoint. Concurrency limit 6 preserves the
  v10.0.195 thundering-herd fix.
- `apps/statenour/src/inngest/functions/index.ts` · barrel export
- `apps/statenour/app/api/inngest/route.ts` · serve endpoint mounting
  every function from the barrel
- This ADR

### What does NOT ship in Phase 3

- The legacy `/api/cron/mega` route stays put. It remains the source
  of truth until the operator flips `INNGEST_MEGA_V2=true` in env.
- No existing child cron is modified. Each child stays at its current
  HTTP URL · Inngest dispatches via the same URLs. This means the
  cutover is reversible in one env flip.
- No additional functions yet. Subsequent phases (4 LiveKit · 5
  morning brief · 6 Customer 360) add functions as they need them.

### Cutover flow

1. **Operator action items** (one-time):
   - Create Inngest account at https://app.inngest.com (free tier)
   - Create app `statenour-web` in the dashboard
   - Paste `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` into Railway
     statenour-web env vars
   - In the Inngest dashboard "Apps" page: connect
     `https://statenour-web-production.up.railway.app/api/inngest` (PUT triggers registration)
2. **Verify** (Inngest dashboard): the two functions
   (`mega-fanout-morning` and `mega-fanout-evening`) appear with
   their cron schedules
3. **First-run watch**: the next 9:00 UTC trigger fires through
   Inngest · operator monitors the run in the Inngest dashboard ·
   cross-checks against `/system/crons` for parity
4. **Decommission legacy**: disable the Railway cron entry for
   `/api/cron/mega` once 7 consecutive runs match · the route file
   stays in the codebase as a fallback for emergency rollback

### Rollback

- **Per-deploy rollback**: revert the Railway cron change · the
  legacy route still works · Inngest functions are no-ops without
  the cron trigger
- **Whole-feature rollback**: delete `INNGEST_EVENT_KEY` from Railway
  env · the SDK falls back to dev mode · no production impact

## Rejected alternatives

### Temporal

Full-fat durable execution platform. More powerful than Inngest
(arbitrary workflow languages · long-running activities · child
workflows). But:
- Self-hosted requires Cassandra/PostgreSQL/Elasticsearch trio · not
  free in dev or prod
- Cloud (Temporal Cloud) starts at ~$200/mo · way over budget
- Workflow code lives in a separate worker process · breaks the
  "stays in the Next.js app" constraint
- TypeScript SDK is mature but the deployment story (workers · task
  queues · namespaces) adds significant operator burden

Reserved for: future state where we have a workflow engine team. Not
today.

### Trigger.dev

Closest competitor to Inngest. Newer (v3 launched late 2024 with a
new runtime · the v2 deprecation forced a rewrite for early adopters).
The platform is good but Inngest's `step.run` semantic + the maturity
of the SDK (now at v4.4) won the comparison. Trigger.dev's Public
v3 has reliability issues in dashboards still working through.

If Inngest pricing changes meaningfully or the platform shifts
direction, Trigger.dev is the cheapest swap (same `step.run` shape).

### Self-hosted job queue (BullMQ + Redis · pg-boss · sidekiq-style)

Free in dollars, expensive in cognitive overhead. We'd own:
- Redis or Postgres-based job store (we already have Postgres but
  not a battle-tested job table schema)
- Worker lifecycle (deploy · health check · graceful shutdown)
- Dashboard (build it ourselves or settle for Bull-board's basics)
- Retry logic (each pattern slightly different · own the bugs)

Inngest is $0 at our volume AND has a dashboard. The build-vs-buy
math is one-sided.

### Stay on `Promise.all` + `withConcurrency`

The status quo. Works for the happy path. Fails the three pain
points enumerated above. The Wave-200 commitment is to remove these
limitations, not work around them.

## Consequences

### Positive

- **Per-step retry** · transient AI provider rate-limits stop
  cascading to "partial fan-out forever"
- **Replay button** · the Inngest dashboard shows every run · failed
  runs replay in one click · zero ad-hoc curl
- **`step.waitForEvent`** · unlocks human-in-loop workflows (Phase 4
  voice approval · Phase 5 morning brief confirm · Phase 6 customer
  outreach approve) without custom state machines
- **One-click cron** · adding a new scheduled function is `{ cron:
  "0 7 * * *" }` instead of editing Railway/Vercel cron config + the
  mega fan-out arrays
- **Operator visibility** · the Inngest dashboard surfaces
  reliability data the operator can scan in 5 seconds vs. parsing
  `/system/crons` for partial-success patterns

### Negative

- **Vendor dependency** · Inngest is a SaaS · they go down, our
  workflows pause. Mitigation: the legacy `/api/cron/mega` route
  stays warm for emergency rollback via Railway cron schedule (one
  env flip).
- **Cold-start cost on serve endpoint** · every Inngest invocation
  goes through `/api/inngest` which loads `inngest/next` + our
  function bundle. The dynamic import in the route minimizes this
  but doesn't eliminate it.
- **Duplicate fan-out arrays during cutover** · `MORNING_JOBS` and
  `EVENING_JOBS` are duplicated in `src/inngest/functions/mega-fanout.ts`
  and `app/api/cron/mega/route.ts` during the cutover window. Plan:
  collapse to one source of truth (probably in a shared `config/`
  module) once cutover sticks past 7 consecutive successful runs.

### Neutral

- **No data model changes** · Inngest stores its own state · we
  don't add tables to Postgres
- **No new auth boundary** · the SDK reuses Inngest's signing-key
  HMAC for inbound · our existing cron auth (Bearer token) is
  preserved between mega-fanout and child crons

## Operator action items

Per the cutover flow above. None of these are blocking — Phase 3
ships the code today, the operator wires the credentials on their
schedule. Until they do, the serve endpoint runs in dev mode (works
locally · skipped in prod).

1. Create Inngest account (free)
2. Create app `statenour-web`
3. Paste `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` into Railway env
4. Connect `https://statenour-web-production.up.railway.app/api/inngest` in Inngest dashboard
5. Wait one cycle · verify dashboard shows expected functions
6. Disable Railway cron entry for `/api/cron/mega`
7. Verify 7 consecutive successful runs · collapse duplicated job arrays

## References

- `apps/statenour/src/inngest/client.ts` — singleton client
- `apps/statenour/src/inngest/functions/mega-fanout.ts` — Phase 3
  flagship function
- `apps/statenour/app/api/inngest/route.ts` — serve endpoint
- `apps/statenour/app/api/cron/mega/route.ts` — legacy fan-out (stays
  during cutover window)
- `apps/statenour/lib/utils/concurrent.ts` — `withConcurrency` helper
  (still in use until full cutover)
- ADR-0001 · Mastra adoption (the substrate move that started this
  wave)
- ADR-0002 · Braintrust (eval correlation lives there)
- Inngest docs: https://www.inngest.com/docs/learn/step-by-step
