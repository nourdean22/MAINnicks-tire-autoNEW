# DB Migration Policy · statenour-os

**Status:** Active as of v10 (Track B.4).
**Owner:** Operator (Nour).
**Source of truth for schema changes:** `prisma/schema.prisma` + `SchemaChangeLedger` table.

---

## Why this exists

> **v10.0.529.106 Wave 75 correction**: the original line claimed
> "no migration SQL files in `prisma/migrations/`" — that's no
> longer true. As of 2026-05, all schema changes ship as proper
> Prisma migration files in `prisma/migrations/` (see
> `20260516140000_ai_generation_conversation_id` +
> `20260516160000_brain_bus_event_trace_id` +
> `20260516170000_body_tracking_health_fields` for Wave-59-63
> examples). The SchemaChangeLedger pattern below still applies as
> the "why + intent" companion to the migration SQL.

The project uses Prisma migrations for schema changes (the live
contract). The SchemaChangeLedger pattern below adds the WHY +
WHO context that the migration SQL doesn't carry. Original
text retained for historical accuracy:

1. **No SQL audit trail.** When the schema drifts, you can't reconstruct WHEN it changed, WHO changed it, or WHY.
2. **No rollback plan by default.** A `db push` succeeds or fails atomically, but there's no record of "if this is wrong, here's how to undo."

The schema-drift sentinel (v8.6) catches DRIFT (live DB doesn't match `schema.prisma`), but it can't tell you the history.

`SchemaChangeLedger` (v10 Track B.4) closes that gap.

---

## Ledger contract

Every schema change — every `db push`, every raw SQL, every (eventually) migration file — must produce one row in `SchemaChangeLedger`.

The row captures:

| Field | Purpose |
|---|---|
| `changeKey` (unique) | Operator-mintable identifier, e.g. `v10.0.2-add-schema-ledger` |
| `title` | One-liner |
| `reason` | Why this change is needed |
| `changeType` | `add_column` / `drop_column` / `alter_index` / `fk_change` / `enum_add` / `rename` / `other` |
| `method` | `db_push` / `migrate` / `raw_sql` |
| `environment` | `local` / `preview` / `production` |
| `sqlSummary` | Plain-language summary of the SQL |
| `prismaDiff` | Optional copy of the schema.prisma diff |
| `destructive` | `true` if the change loses data (drop column, narrow type, etc.) |
| `approvedBy` | Operator name when destructive |
| `appliedBy` | Who ran the change |
| `appliedAt` | Timestamp |
| `rollbackPlan` | How to undo if needed |
| `status` | `planned` / `applied` / `rolled_back` / `failed` |

---

## Policy by phase

### Short-term (v10)

`db push` remains the default workflow. Every push must:

1. Be paired with a `SchemaChangeLedger` row written via `recordSchemaChange()` from `lib/db/schema-ledger.ts`
2. Include a `rollbackPlan` if `destructive: true`
3. Set `appliedAt` immediately after `prisma db push` succeeds

Non-destructive changes (add column with default, add index, add new model) can be self-approved.

Destructive changes (drop column, narrow type, drop table, rename column) must:
- Set `approvedBy: "operator"` only after explicit operator approval in the chat session
- Document the rollback in `rollbackPlan`
- Include the data-migration step inline in `sqlSummary` if the column had values

### Medium-term (v10.x → v11)

Production schema changes migrate to actual migration files (`prisma migrate dev` + `prisma migrate deploy`). `db push` becomes emergency-only.

The ledger continues to record every change regardless of method.

### Long-term (v11+)

Migration files become the only path to production. `db push` is restricted to local dev. Drift detection becomes hard-fail in CI.

---

## Operator workflow today

```bash
# 1. Edit prisma/schema.prisma
$EDITOR prisma/schema.prisma

# 2. Plan the change — write the ledger row FIRST
pnpm exec tsx scripts/record-schema-change.ts \
  --key "v10.0.x-my-change" \
  --title "..." \
  --reason "..." \
  --type "add_column" \
  --destructive=false

# 3. Apply
DATABASE_URL=$(...) pnpm exec prisma db push --url "$DATABASE_URL"

# 4. Mark applied
pnpm exec tsx scripts/record-schema-change.ts \
  --key "v10.0.x-my-change" \
  --mark-applied
```

The script wraps the `recordSchemaChange()` library calls and prompts for missing fields.

For changes that happen as part of a v9.1.x / v10.x.x commit, the ledger row is created during the same commit so the change history is in git AND the DB.

---

## Backfill

Schema changes that landed BEFORE v10 Track B.4 are not in the ledger. The project memory + commit history capture them implicitly:

- v9.0-rc · `Task.proof` JSON column added
- v9.1.5 · indexes for soft-delete coverage on most models
- v9.1.15 · Cascade→Restrict on Mission→Task / LifeGoal→GoalEvent / Task→TaskEvent + `BrainMemory @@index([category, deletedAt])`
- v10.0.1 · `BrainBusEvent` model added
- v10.0.2 · `SchemaChangeLedger` model added

Backfilling these into the ledger is OPTIONAL — the ledger is forward-looking. For an audit trail of past changes, `git log -- prisma/schema.prisma` remains authoritative.

---

## Acceptance criteria

The policy is in force when:

1. `SchemaChangeLedger` table exists in production · ✅ (v10.0.2)
2. `lib/db/schema-ledger.ts` helper library exists · ✅ (v10.0.2)
3. `/system/schema-history` page reads from the ledger · ⏳ (v10.0.3)
4. `scripts/record-schema-change.ts` CLI helper exists · ⏳ (v10.0.3)
5. v10 release gate enforces: every schema change since v10.0.2 has a ledger row · ⏳ (v10 ship gate)

---

## See also

- `prisma/schema.prisma` — schema source of truth
- `lib/db/schema-ledger.ts` — ledger helpers
- `lib/db/schema-sentinel.ts` — drift detection (v8.6)
- `docs/RECONCILIATION.md` — current state truth

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
