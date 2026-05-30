# Postmortem: Cron fan-out silently ~70% dead for 2 days

**Date**: 2026-05-30
**Author**: operator + Claude (remote-exec session)
**Status**: Final
**Severity**: SEV2 (major internal degradation · statenour is the operator's personal OS, not customer-facing — no external user impact, but the brain/automation layer was largely inert)
**Duration**: ~44h (2026-05-28 09:01 UTC → 2026-05-30 ~05:00 UTC)

## Executive Summary

The Wave AE cron prune (commit `cfc6b38b`, 2026-05-28) deleted ~51 cron route files but did not remove their references from `src/inngest/jobs.ts` — the array the mega fan-out iterates. Every fan-out run then fetched ~51 non-existent `/api/cron/<x>` routes, each returning 404. `dispatchChild` throws on non-2xx, and the fan-out used `Promise.all`, so the first exhausted-retry rejection failed the **entire** run, starving every child that had not yet completed.

**Impact**: only ~16 of ~50 crons fired for ~2 days. The morning fan-out fired just 2 of its jobs. Core brain crons (reflect/think/learn equivalents via their surviving consolidate/predict/intelligence set), data-source freshness, and Nick's feeders ran intermittently or not at all. No data loss.

**Detection**: not by any alert. Found 2026-05-30 by manually querying the prod Neon `CronJobLog` during an unrelated silent-failure sweep.

## Timeline (UTC)

| Time | Event |
|------|-------|
| 2026-05-28 11:52 | `cfc6b38b` (Wave AE) merged — deletes ~51 cron routes + rewrites `config/crons.ts`; leaves `jobs.ts` refs intact |
| 2026-05-28 ~09:01 | Last fan-out run where most jobs still fired (their final `CronJobLog` rows) |
| 2026-05-29 09:00 | Morning fan-out fires — only `stale-tasks` + `ingest-drive` complete; rest starved |
| 2026-05-29→30 | Evening fan-out partially fires (~13 jobs); morning near-dead; nothing alerts |
| 2026-05-30 ~04:30 | Silent-failure sweep queries `CronJobLog` last-30h → 16/50 firing; morning = 2 |
| 2026-05-30 ~04:50 | Root cause confirmed: 51 `jobs.ts` refs point to deleted routes (filesystem diff) |
| 2026-05-30 ~05:00 | Fix `06ad31a9` pushed — jobs.ts cleaned, `allSettled`, `verify-crons` [5/5] guard |

## Root Cause Analysis

Three independent conditions had to coincide; each alone was survivable.

1. **Stale fan-out refs (proximate).** Wave AE deleted route files but not their entries in `jobs.ts`. The file's own header even states the retirement contract — *"Remove from the array below, then the route file may be deleted"* — which was done in the wrong order.
2. **`Promise.all` (amplifier).** The fan-out awaited all children with `Promise.all`, so one child's terminal failure rejected the whole batch and cancelled the un-started children. The Inngest design intent was per-step isolation; `Promise.all` defeated it.
3. **Blind verifier (detection gap).** `pnpm check:crons` validated `config/crons.ts` (the metadata manifest) against the filesystem, but **never** checked `jobs.ts` (the thing that actually fires). So the 51 dead refs passed every gate — typecheck, check:crons, build.

### 5 Whys
- Why did most crons stop firing? → The fan-out function failed before reaching them.
- Why did it fail? → It fetched deleted routes → 404 → threw → `Promise.all` rejected.
- Why were deleted routes still fetched? → Their refs were left in `jobs.ts` after the prune.
- Why did nothing catch the stale refs? → `check:crons` only validates the manifest, not `jobs.ts`.
- Why did nothing catch the 2-day silence? → There is no monitor that asserts "expected crons actually ran." Liveness was never measured.

## Detection

**What didn't work:** every safety net. Typecheck green, `check:crons` green, build green, no Telegram alert (the fan-out's `onFailure` either didn't fire or was lost in noise). The only thing that surfaced it was a human querying the run-history table by hand, days later, for an unrelated reason.

**The gap:** we measure cron *outcomes* opportunistically (a tile here, a probe there) but never assert cron *liveness*. A dead cron is invisible because absence-of-a-row triggers nothing.

## Impact

- ~34 of ~50 scheduled crons did not run reliably for ~2 days.
- Brain synthesis, data-source freshness probing, and Nick's email/calendar/relationship feeders degraded.
- No data loss, no security impact, no external-user impact (personal OS).
- Cost: negligible $ — but ~2 days of the system's "intelligence" layer was inert while appearing healthy.

## Lessons

**What went well**
- `CronJobLog` existed and was complete — ground truth was recoverable.
- Once suspected, root cause → fix was ~30 min (filesystem diff is unambiguous).

**What went wrong**
- A "chore" prune deleted runtime wiring without updating the firing source of truth.
- Two sources of truth (`config/crons.ts` manifest vs `jobs.ts` fan-out) drifted, and only one was verified.
- No liveness monitor — the failure was structurally invisible.

**Where we got lucky**
- The break coincided with an unrelated sweep. Without it, the crons could have stayed ~70% dead for weeks (the same class hid the v10.0.42 ghost-feeder bug "for weeks" — see the data-source-health module header).

## Action Items

| Priority | Action | Status |
|----------|--------|--------|
| P0 | Clean `jobs.ts` to only-existing routes + `Promise.all` → `allSettled`+throw-summary | DONE `06ad31a9` |
| P0 | `verify-crons` [5/5]: every `jobs.ts` fan-out ref must have a route on disk | DONE `06ad31a9` |
| P0 | **Cron-heartbeat watchdog** — meta-cron reads `CronJobLog` last-run age per `ALL_MEGA_JOBS` entry; fires P0 Coach event + Telegram if any expected cron is silent past 2× its interval. Liveness, not outcomes. | TODO |
| P1 | Reconcile the two sources of truth — `config/crons.ts` lists 33 "active" but only 21 fire; either make the manifest honest or add a manifest↔fan-out `verify-crons` check | TODO |
| P1 | `ingest-gmail` runs 1×/day via the fan-out but its spec is every-30min — give it a dedicated Inngest trigger if timely email nudges matter | TODO |
| P2 | Evaluate native Inngest event fan-out (`step.sendEvent` → per-child functions) to remove the single-function duration bottleneck + the need for `allSettled` | TODO |

## References
- Fix commit: `06ad31a9` · Cause commit: `cfc6b38b` (Wave AE)
- `src/inngest/jobs.ts`, `src/inngest/functions/mega-fanout.ts`, `scripts/verify-crons.ts`
- Related class: `lib/contracts/data-source-health.ts` header (the same ghost-feeder class, caught "weeks" late in v10.0.42)
