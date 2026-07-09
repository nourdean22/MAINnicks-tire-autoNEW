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

## Type drifts — flagged 2026-07-07, RESOLVED 2026-07-09 after per-caller review

Each got the individual caller review the flag demanded; all five aligned to prod with zero behavior change:

| Column | Drizzle → DB | Caller evidence → why alignment is safe |
|--------|-------------|------------------------------------------|
| `competitor_snapshots.raw_payload` | `text` → `json` `[V]` | No code reads or writes `rawPayload` (insert `competitorMonitor.ts:145` omits it; only select is projected to name/rating). |
| `search_performance.date` | `varchar` → `date({mode:"string"})` `[V]` | `mode:"string"` keeps string-in/string-out. Insert passes the GSC string (`gsc-data.ts:466`); all reads are raw `` sql`` `` BETWEEN fragments (type-agnostic). |
| `cron_alerts_fired.fired_for` | `timestamp` → `date({mode:"string"})` `[V]` | All writes/reads are raw-SQL `INSERT IGNORE` dedupe keyed on date strings — the decl's own comment admitted "fired_for is DATE in prod". |
| `customers.smsOptOut` | `int` → `tinyint` `[V]` | Both map to JS `number`; consumer does `Boolean(r.smsOptOut)`. Golden suite 40/40 green. |
| `vapi_call_logs.eval_score` | `int` → `tinyint` `[V]` | Both `number`; read via drizzle `avg()` + raw SQL. |

## `review_pipeline` — reclassified from "harmless dead decls" to LIVE BUG №3, fixed 2026-07-09

The 2026-07-07 note ("harmless — not written") missed the read side: `getPipelineReviews()`
(`gbp-reviews.ts:715`, admin dashboard) does a **full `d.select()`**, which emits every *declared*
column — including `adminNotes`/`updatedAt`, absent in prod → `Unknown column` on every call.
Same failure class as bug 1 (`conversionHits`). The decl was drifted in **both directions**:

| Column | Drizzle 07-07 | Prod | Fix |
|--------|--------------|------|-----|
| `adminNotes`, `updatedAt` | declared | **absent** | removed from decl (no consumer reads them; insert never set them) `[V]` |
| `keywordsJson`, `urgency`, `status` | **missing** | present | added to decl (nullable/defaulted — insert at `:679` unaffected) `[V]` |
| `reviewed`, `responseSent` | declared | present | kept; also added to the `CREATE TABLE` bootstrap (`intelligence.ts:487`) which was missing both, so fresh DBs now converge to prod's 15 columns `[V]` |

_Clarity Gate: REVIEWED (2026-07-09). Every disposition verified against prod `information_schema`
dump + grep of all callers, not assumptions. Post-fix drift check: **0 type drifts, 0 phantom
columns, 39/39 FKs reproducible, phone10 synced — prod and code fully agree.** tsc 0 · vitest green
(the only symbol-coupled suite, smsOrchestrator golden, 40/40)._
