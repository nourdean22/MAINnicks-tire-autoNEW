# Runbook · Task classifier — domains, missions, learning

- **Status:** active · **Domain:** ai-classification · **Risk:** medium · **Last verified:** 2026-06-09
- **When to use:** touching task creation/classification, mission/goal linkage, or the auto-learn loop.
- **Source of truth:** [`../../lib/ai/classify-task-linkage.ts`](../../lib/ai/classify-task-linkage.ts), [`../../lib/services/mission-helpers.ts`](../../lib/services/mission-helpers.ts).

## Rules

1. **Do not learn from bulk migration moves.** When tasks are re-homed in **bulk** (a mass mission migration), that is mechanical re-filing, not a classification signal — the auto-learn loop must **do not learn** from those moves, or it will drift.
2. **Correction capture is fire-and-forget.** A user correcting a single task's classification IS a legitimate learning example — but capturing it must never block or fail the user's action.
3. **GENERAL anchors are protected.** The **general** bucket's anchors are protected from learning drift — never let accumulated examples pull the GENERAL classification around.
4. **One re-file = one example.** A user manually re-filing a single task is the canonical positive learning example (the opposite of a bulk move).

## Gotchas

- **Inbox missions ≠ user projects.** Three surfaces (cap, Plan view, Track tile) all use `isInboxMission()` in `mission-helpers.ts` — don't introduce a fourth filter; use the helper.

## Commands

```
pnpm test -- tests/lib/ai
```

## Verification

- Classifier + linkage unit suites green; a bulk move produces **no** new learning rows.

## Rollback

- Revert the classifier change; learning rows are additive and idempotent per `sourceKey`.
