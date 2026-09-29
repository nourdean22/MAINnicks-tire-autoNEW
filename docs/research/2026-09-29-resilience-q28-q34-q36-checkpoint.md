# NOUR OS resilience checkpoint — Q-28 / Q-34 / Q-36

**Date:** 2026-09-29  
**Branch:** `feat/nouros-resilience-q28-q34-q36-20260929`  
**Status rule:** BUILT means committed on this branch. It does not mean merged, deployed, or live-verified.

## Q-28 · Cron observer Alertmanager semantics — BUILT, NOT MERGED

Built on the existing Nick's cron observer; no second monitoring stack and no new dependency.

### Grouping
- Job failures due in the same observer pass are grouped into one bounded Telegram body.
- Loop-shape findings due in the same pass join that same message.
- Existing per-incident suppression windows remain:
  - failure streaks: 6h
  - loop-shape findings: 24h
- Dedupe still persists in `shop_settings`; a deploy does not reset the suppression window.

### Dependency inhibition
- A database-root incident is inferred only when at least two distinct jobs independently carry connection-shaped failures.
- One job's SQL/validation error is not enough to call the database down.
- If the observer itself cannot read `cron_log` because the DB dependency is unavailable, it emits the root dependency page and rethrows so the observer run is recorded failed.
- While the DB root is active, downstream job/shape pages are inhibited rather than exploding one root cause into many alerts.
- Root dependency incidents bypass quiet hours.

### Resolved notices
- Alerted incidents persist an active bit in `shop_settings`.
- A later pass compares previously-alerted incidents with the current active set and sends one grouped resolved notice.
- Quiet hours defer recovery messages by leaving the active bit intact; recovery truth is not discarded.
- During a DB-root incident child active state is frozen so inhibition can never masquerade as recovery.

### Quiet hours
- Normal job/shape noise uses the existing policy window 22:00–07:00 in the shop timezone.
- Root database dependency pages bypass the mute.

### Verification included
- `server/cron/alertPolicy.test.ts`:
  - quiet-window boundaries;
  - grouping;
  - resolved formatting;
  - database-root threshold;
  - DB-error classification;
  - incident-resolution diff.
- Existing observer suppression canaries remain.

## Q-34 · PROCESS_ROLE — BUILT, NOT MERGED

Added `PROCESS_ROLE=all|web|jobs`.

- Default: `all`.
- `all`: today's behavior — HTTP + background ownership.
- `web`: HTTP stays alive; background scheduler/processors do not start.
- `jobs`: HTTP health/admin surfaces stay alive and this process owns background work.
- Invalid values fail loudly instead of silently duplicating or disabling jobs.
- `PRERENDER_MODE` still suppresses background work independently.

This PR does **not** split Railway into another service. It only makes ownership explicit so a later service split is a configuration operation instead of another scheduler rewrite.

## Q-36 · StateNour worker hygiene — BUILT, NOT MERGED

### Dead mega route removal
Removed worker:
- `POST /cron/mega`
- `POST /cron/mega-evening`
- their now-dead inbound secret comparison helper

The worker still fails closed at boot when `CRON_SECRET` is absent because its four worker-owned forwards authenticate to StateNour web with that bearer.

### Live Railway evidence used before deletion
Read-only Railway inspection on 2026-09-29 found:
- project `natural-appreciation`;
- exactly four services:
  - `MAINnicks-tire-auto`
  - `statenour-web`
  - `statenour-worker`
  - `Redis`
- no service is a Railway cron job;
- `statenour-worker` has no cron schedule;
- worker service ID is `5441c378-3bab-4bb7-958f-36961159f5fe`;
- worker runs one replica in `us-east4-eqdc4a`;
- worker has no Railway service/custom domain.

Therefore the legacy worker mega endpoints have no Railway platform caller.

### Secret/env census
Worker source does not read:
- `DATABASE_URL`
- `DIRECT_URL`
- `GITHUB_TOKEN`

Those variables can still exist on the Railway service. This code change does **not** delete live variables. Removing them is an explicit operator infrastructure action.

### Render timeout
No duplicate timeout was added: `packages/reel-engine/src/render.ts` already owns a finite 10-minute wall-clock limit, overridable by `REEL_RENDER_TIMEOUT_MS`. The Q-36 repo canary pins that existing boundary.

### Mega fan-out truth boundary
StateNour's Inngest mega functions are registered but still guard on `INNGEST_MEGA_V2=true`.
The Railway OAuth connector confirms that variable exists but redacts its value. This session could not query production `CronJobLog` because the Neon connector requires the exact Neon project ID, which is not present in repo/prior context.

**Do not claim production mega firing from this branch.** Verify `mega` and `mega-evening` receipts in `cron_job_logs` / Inngest before calling the cutover live.

## Operator-owned follow-ups

1. Verify production `mega` / `mega-evening` receipts or the effective `INNGEST_MEGA_V2` value.
2. If desired, remove unused worker Railway variables only after that separate infrastructure review:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `GITHUB_TOKEN`
   - plus any other confirmed-unused inherited variables.
3. A future Nick's service split may set:
   - public service: `PROCESS_ROLE=web`
   - jobs service: `PROCESS_ROLE=jobs`
   only after a duplicate-run deployment rehearsal. Default remains `all`.

## Merge acceptance

Before merge:
- exact-head Nick TypeScript/test/build gates green;
- StateNour repo worker-hygiene test green;
- worker build/check green through affected CI;
- Adoption Gates green;
- Completion Authority green;
- current main rechecked for overlap immediately before squash merge.


## Q-31 discovery checkpoint · memory truth wiring started

Read-only source census on 2026-09-29 established:

- `lib/brain/memory-admission.ts` already owns the semantic admission envelope and `admitMemory()`.
- `brainMemory.remember()` already routes through the existing memory commit gateway; Q-31 does **not** need a second memory write authority.
- Several high-value machine-inferred writers still bypass the admission door with direct Prisma writes, including journal extraction, session distillation, and belief harvesting.
- `BrainMemory` already has event/effective-time semantics through `validFrom` / `validUntil` plus `supersededById`.
- **Critical schema collision:** the existing TTL field `expiresAt` already maps to database column `expires_at`. The architecture note's proposed transaction-time `expired_at` cannot be implemented by repurposing that column without corrupting retention semantics.
- Therefore Q-31 will use a separate additive transaction-time field/column and keep TTL expiry untouched. The exact DB name must remain distinct and the pending migration/operator gate must make that explicit.
- The direct-writer ratchet in `tests/repo/brain-memory-direct-writers-ratchet.test.ts` remains the enforcement surface; converted semantic writers must shrink the allowlist rather than bypassing it.

Still to build:
1. transaction-time expiry field + pending additive migration;
2. overlap-safe supersession transaction that closes the prior transaction interval only when the effective intervals overlap and the old event-time starts before the new event-time;
3. route selected machine-inferred writers through `admitMemory()`;
4. index-constrained contradiction shadow at the admission gateway;
5. retro-dated correction tests proving both “what was true at t?” and “what did I believe at t?” views.

This is BUILT-DISCOVERY only at this checkpoint; no Q-31 code or production migration is claimed yet.
