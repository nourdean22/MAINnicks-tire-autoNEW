# Migration 0002 · journal_threads + journal_thread_memberships

> **Status**: PARKED · awaiting operator apply to Neon prod
> **ADR**: 0013 · journal pattern-radar
> **Phase**: Wave-200 Phase D (post-goals page merge sibling)

## What it does

Adds two tables:

- `journal_threads` · operator-named clusters detected by nightly
  convergence scan
- `journal_thread_memberships` · polymorphic membership rows
  `(threadId, entrySource, entryId)` linking entries from the 4
  source tables (brain_dumps · reflections · situation_logs ·
  decision_replays) into a thread

## Why parked

Per WAVE-200-PLAN.md non-negotiable #1: no prod DB schema changes
without parked migration first.

## How to apply

```bash
# Option A · Neon SQL editor (recommended)
#   1. Open Neon dashboard · production branch · neondb · SQL editor
#   2. Paste contents of migration.sql · Run
#   3. Verify via:
#        SELECT count(*) FROM journal_threads;
#        SELECT count(*) FROM journal_thread_memberships;

# Option B · psql direct
psql "$DATABASE_URL" -f apps/statenour/prisma/migrations-pending/0002_journal_threads/migration.sql
```

After applying:
```bash
pnpm --filter @statenour/web exec prisma generate
# Redeploy statenour-web on Railway · types pick up
```

## Rollback

```sql
BEGIN;
DROP TABLE "journal_thread_memberships";
DROP TABLE "journal_threads";
COMMIT;
```

## Why this design

- **Polymorphic membership** · the 4 entry sources are bounded
  (no new source type planned) · 4 separate FK join tables would
  be 4x the surface area for no real benefit
- **Soft delete on threads** · operator might want to recover an
  archived thread later · `deletedAt` keeps the door open
- **Cascade on memberships** · deleting a thread cleans the join
  table · this is intentional (orphan memberships make no sense)
- **Indexes match the access patterns** · `status` for the rail
  filter · `lastJoinAt` for the dormancy sweep · `(threadId)` and
  `(entrySource, entryId)` for both directions of membership lookup

See `docs/adr/0013-journal-pattern-radar.md` for full context.
