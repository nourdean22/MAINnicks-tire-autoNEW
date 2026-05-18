# ADR-0012 · Mission.lifeGoalId FK · first-class mission↔goal relation

> **Status**: Accepted · APPLIED to Neon prod 2026-05-18
> **Date**: 2026-05-18 · Phase A.3 schema follow-up to ADR-0010
> **Decision drivers**: operator explicitly asked · implicit task-derived
> linking documented as weak in ADR-0010 · ready to make it first-class

---

## Context

ADR-0010 shipped `/goals` with implicit mission↔goal linking (derived
via shared `task.goalId` + `mission.tasks` intersection). The negative
consequence noted at the time:

> Mission → goal connection is implicit · derived via shared tasks
> · not first-class FK. Auto progress-bump on mission completion can't
> fire reliably. Operator accepts; if it bites, ADR-0011 (Phase A.3)
> adds the FK.

Operator asked to ship the FK now. This ADR documents the migration.

## Decision

Add `Mission.lifeGoalId String?` column + FK to `life_goals.id`.

### Schema change (Prisma · already shipped)
```prisma
model Mission {
  lifeGoalId         String?
  lifeGoal           LifeGoal?  @relation(fields: [lifeGoalId], references: [id], onDelete: SetNull)
  @@index([lifeGoalId])
}

model LifeGoal {
  missions Mission[]  // back-ref
}
```

### Migration (parked SQL)
```sql
ALTER TABLE "Mission" ADD COLUMN "lifeGoalId" TEXT;
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_lifeGoalId_fkey"
  FOREIGN KEY ("lifeGoalId") REFERENCES "life_goals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Mission_lifeGoalId_idx" ON "Mission"("lifeGoalId");
```

Parked at `apps/statenour/prisma/migrations-pending/0001_mission_lifegoalid/`
per operator's migration discipline (WAVE-200-PLAN non-negotiable #1:
no prod DB schema changes without parked migration first).

### Behavior
- **Nullable** · existing missions don't break · backfill is gradual
- **SET NULL on goal delete** · operator deleting a goal doesn't
  cascade-kill missions (operator may want orphan to re-tag)
- **Indexed** · supports the common access pattern (LifeGoal sidebar
  shows missions for goal X)

## What ships today

| File | Purpose |
|---|---|
| `apps/statenour/prisma/schema.prisma` | Mission gains `lifeGoalId` + relation · LifeGoal gains `missions Mission[]` back-ref |
| `apps/statenour/prisma/migrations-pending/0001_mission_lifegoalid/migration.sql` | Parked SQL · operator applies to Neon when ready |
| `apps/statenour/prisma/migrations-pending/0001_mission_lifegoalid/README.md` | Apply + rollback + verification steps |
| `docs/adr/0012-mission-lifegoal-fk.md` | This ADR |

Note: Prisma client regenerated locally so new types are available to
services · the DB column doesn't exist yet · any code that WRITES to
`lifeGoalId` before the migration is applied will throw a Prisma error
at runtime. Services using the existing implicit derivation continue
to work unchanged. No code writes `lifeGoalId` today.

## What ships AFTER operator applies the migration

- `/goals` page service reads `goal.missions` directly (currently
  derives via tasks)
- Mission CRUD UI surfaces a "parent goal" dropdown
- Optional: mission completion bumps parent goal progress (future)

## Rejected alternatives

### Skip the FK · keep deriving via tasks
ADR-0010's original stance. Operator now wants the cleaner relation ·
implicit derivation feels brittle (tasks come and go · the link should
outlive the tasks that defined it).

### Required (NOT NULL) FK
Would force backfill before deploy · creates migration coordination
risk · nullable is the safe path.

### Many-to-many join table
Missions could plausibly serve multiple goals. Today they don't · YAGNI
says single FK · upgrade later if needed.

## Consequences

### Positive
- First-class relation · `LifeGoal.missions` Prisma include works
- /goals sidebar can show "missions for this goal" without shared-task
  derivation
- Cleaner mental model · matches operator's stated intent

### Negative
- Operator action required to apply migration
- Backfill is manual · existing missions stay null until tagged
- Until migration applies, any code that WRITES `lifeGoalId` errors
  (none ships today · just schema declaration)

### Neutral
- Implicit task-derived linking still works · no breaking change
- Rollback is trivial (DROP column + index + FK · 1 transaction)

## Operator action items

1. ~~Apply parked migration when comfortable~~ — APPLIED 2026-05-18 via
   Neon SQL editor in single transaction
2. Run `pnpm --filter @statenour/web exec prisma generate` after apply
   (already done at commit time · types already shipped)
3. Redeploy statenour-web on Railway · types pick up — no action needed,
   the next deploy auto-includes the regenerated client

## References

- `apps/statenour/prisma/schema.prisma`
- `apps/statenour/prisma/migrations-pending/0001_mission_lifegoalid/`
- WAVE-200-PLAN.md non-negotiable #1 · migration discipline
- ADR-0010 · /goals page merge (noted this as Phase A.3 follow-up)
