# Migration 0001 · Mission.lifeGoalId

> **Status**: PARKED · awaiting operator apply to Neon prod
> **ADR**: 0012 · explicit Mission→LifeGoal first-class relation
> **Phase**: Wave-200 Phase A.3 (post-goals page merge)

## What it does

Adds `Mission.lifeGoalId String?` column + FK to LifeGoal + index. Makes
the mission↔goal relationship first-class (previously: implicit via
shared tasks · ADR-0010 noted this as a "weaker" trade-off).

## Why parked

Per WAVE-200-PLAN.md non-negotiable #1:

> No prod DB schema changes without a parked migration first.

(That rule was forged from the `Task.snoozed_until` incident · see
`docs/WAVE-200-PLAN.md` line 315 for the full list.)

The Prisma schema has been updated (operator can `pnpm prisma generate`
to refresh types · build still works). This SQL applies the change to
prod. Operator runs when they're comfortable with the Neon-side change.

## How to apply

```bash
# Option A · via Neon SQL editor (recommended for one-off changes)
#   1. Open Neon dashboard · pick the production database
#   2. Paste contents of migration.sql into the SQL editor
#   3. Run · single transaction · ~5ms

# Option B · via prisma migrate (if migrations directory adopted)
#   pnpm --filter @statenour/web exec prisma migrate deploy

# Option C · via psql direct
#   psql "$DATABASE_URL" -f prisma/migrations-pending/0001_mission_lifegoalid/migration.sql
```

After applying:
```bash
pnpm --filter @statenour/web exec prisma generate
# Then redeploy statenour-web on Railway (the schema generate writes
# fresh client types · the deployed build will pick them up).
```

## Rollback

Single transaction · zero data loss (column is nullable):

```sql
BEGIN;
DROP INDEX "Mission_lifeGoalId_idx";
ALTER TABLE "Mission" DROP CONSTRAINT "Mission_lifeGoalId_fkey";
ALTER TABLE "Mission" DROP COLUMN "lifeGoalId";
COMMIT;
```

## Pre-apply checks

- [ ] Verify `schema.prisma` has `lifeGoalId` on Mission AND
      `missions Mission[]` back-ref on LifeGoal (both ARE shipped at
      commit · see git log)
- [ ] No other schema drift between local + prod (`prisma migrate
      status` should show only this pending change)
- [ ] Neon connectivity verified (`psql "$DATABASE_URL" -c '\dt'`
      should list tables)

## Post-apply verification

```sql
-- Confirm column + index + FK exist
\d+ "Mission"
-- Should show:
--   lifeGoalId  text       (nullable)
--   Indexes: ... "Mission_lifeGoalId_idx" btree ("lifeGoalId")
--   Foreign-key constraints: ... "Mission_lifeGoalId_fkey" ...
--     REFERENCES life_goals(id) ON DELETE SET NULL
```

## Why operator may want this

The /goals page sidebar currently lists active missions WITHOUT showing
which goal each serves. After this migration:
- Each mission card can show its parent goal tag
- LifeGoal can `include: { missions: true }` for proper join
- Future · completing a mission can auto-bump goal progress (next-day
  consumer; ships separately)

Without applying, /goals still works (uses implicit task-derived link).
