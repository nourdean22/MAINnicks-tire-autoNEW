# nickstire Drizzle ↔ prod schema-drift audit — 2026-07-07

Read-only comparison of every Drizzle-declared column type in `drizzle/schema.ts` (1,537 columns)
against the **actual** prod TiDB `information_schema` (131 tables, 1,590 columns). Triggered by the
FK rollout, which hit `ER_FK_INCOMPATIBLE_COLUMNS` on a column Drizzle called `int` but the DB stored
as `bigint`. Method: dump prod types → offline regex parse of `schema.ts` → diff. No prod writes for
the audit itself.

## Real bugs found (code writes a column the DB rejects)

| # | Where | Bug | Fix | Sev |
|---|-------|-----|-----|-----|
| 1 | `conversation_memory.conversionHits` | Declared in Drizzle + written by `chat.ts` (memory-merge `d.update(...).set({conversionHits})` + conversion reinforcement `sql\`… + 1\``) but **absent in prod** → those UPDATEs throw `Unknown column`, silently breaking chat conversion tracking. | **`ALTER TABLE conversation_memory ADD COLUMN conversionHits INT NOT NULL DEFAULT 0`** (registered in `handleRunMigrations`; applied to prod). `[V]` | **High** |
| 2 | `pipeline_runs` | DB column is **`error`**, but Drizzle declared `errorMessage: text("errorMessage")` and `orchestrator.ts:138` writes `.set({ errorMessage })` on pipeline failure → the failure-logging UPDATE itself throws, masking the real error. | Point the field at the real column: `text("errorMessage")` → **`text("error")`** (field name unchanged, no code change). `[V]` | **High** |

## Type drifts — aligned

| Column | Drizzle → DB | Action |
|--------|-------------|--------|
| `service_affinity_predictions.customer_id` | `int` → **`bigint`** | Fixed decl to `bigint` (also the reason no FK to `customers.id` int is possible). `[V]` |

## Type drifts — FLAGGED, not auto-fixed (changing them changes runtime behavior)

Aligning these would change the JS type the ORM returns and could break callers — each needs its own review:

| Column | Drizzle → DB | Why not auto-fixed |
|--------|-------------|--------------------|
| `competitor_snapshots.raw_payload` | `text` → `json` | `json()` auto-parses; a caller that `JSON.parse()`s the string would double-parse. |
| `search_performance.date` | `varchar` → `date` | `date()` returns a `Date`, not a string — callers comparing/formatting the string change. |
| `cron_alerts_fired.fired_for` | `timestamp` → `date` | `date()` drops time; a time-of-day comparison would change. |

## Cosmetic drifts (no bug — `int` reads a `tinyint` fine; documented for a future cleanup)

| Column | Drizzle → DB |
|--------|-------------|
| `customers.smsOptOut` | `int` → `tinyint(1)` (a boolean flag) |
| `vapi_call_logs.eval_score` | `int` → `tinyint` (0–100 fits) |

## Declared-but-absent, and NOT written by code (harmless dead decls; align or remove)

- `review_pipeline.adminNotes` (`text`) — the only `reviewPipeline` insert (`gbp-reviews.ts:679`) doesn't set it.
- `review_pipeline.updatedAt` (`timestamp`) — same; not written.

_Clarity Gate: REVIEWED (2026-07-07). Every row verified against prod `information_schema` (not the
ORM declaration). Bugs 1–2 + the bigint drift are fixed in this PR; the behavior-changing drifts and
dead decls are documented for individual follow-up, not blind-changed._
