# Dead Prisma Models — Verified April 14, 2026

**ONLY 3 models are actually dead** (zero code references in lib/, app/, components/).
The previous list of 33 was WRONG — 30 of those models are actively used.

## Actually Dead (0 code references)

| Model | Purpose (original) | Safe to drop? |
|-------|-------------------|---------------|
| KnownFace | Camera face recognition | Yes — feature never built |
| ContentCalendar | Content scheduling | Yes — feature not implemented |
| OperatorPattern | Operator behavior patterns | Yes — never used |

## WARNING

The previous version of this file listed 33 models as dead.
**30 of those are actively used.** Dropping them would break:
- UserPreference (push notifications, habits, autopilot settings)
- SituationLog (War Room situation analyzer)
- RunnerNode, ServiceHealth (system health monitoring)
- ScheduledAction (6+ code references)
- And many more.

**ALWAYS verify with `grep -rl "prisma.ModelName"` before dropping.**

## How to Remove (when ready)

1. Verify zero references: `grep -rl "prisma.knownFace" lib/ app/ components/`
2. Check for data: `SELECT COUNT(*) FROM "KnownFace";`
3. If empty: remove model from schema.prisma
4. Run: `npx prisma migrate dev --name drop_knownface_contentcalendar_operatorpattern`
5. Run: `npx prisma generate`
