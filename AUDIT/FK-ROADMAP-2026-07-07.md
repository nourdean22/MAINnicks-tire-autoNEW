# nickstire Foreign-Key Rollout Roadmap — 2026-07-07

nickstire (TiDB v8.5.3-serverless) had **120 tables and zero DB-level foreign keys** — referential
integrity was 100% application-enforced (BE-DATA-1, the assessment's largest structural risk). This is
the phased plan to add them safely, one verified pair at a time.

## Provenance (clarity-gate)

- **Shipped rows** = applied to prod + verified present + code-synced. `[V]`
- **Candidate rows** = agent-mapped from `drizzle/schema.ts` with delete-sites grep-verified against
  `server/`. Exact column names and orphan-cleanliness are **not** guaranteed — **every candidate still
  gets its own read-only pre-check** (orphan count, NULL-aware) before any `ALTER`, exactly as the
  shipped ones did. Some rows below are fuzzy (camelCase vs snake_case duplicates, one junk row) — treat
  as leads, not DDL. `[A]`

## The safe apply procedure (per pair — do NOT batch-apply)

1. Read-only pre-check via `railway run --service MAINnicks-tire-auto -- node <script>` (injects
   `DATABASE_URL`, never printed): count `orphans = child.col IS NOT NULL AND parent.id IS NULL`.
2. If `orphans > 0` → **stop**, report to operator (never auto-delete prod rows).
3. If `0` → apply `ALTER TABLE child ADD CONSTRAINT fk_… FOREIGN KEY(col) REFERENCES parent(id) ON DELETE <semantics>`, then verify via `information_schema.TABLE_CONSTRAINTS`.
4. Code-sync: `.references()` in `drizzle/schema.ts` + entry in `handleRunMigrations`.

**ON DELETE rules:** `CASCADE` only when the child is truly owned and meaningless without the parent
(a message without its conversation). `SET NULL` for optional/nullable links. **`RESTRICT` or `SET NULL`
— never `CASCADE` — for financial/audit/history records** (invoices, payments, loyalty ledger).

## Shipped (39 FKs · nickstire went 0 → 39)

**Wave 5 (2026-07-07) added 8** — owned-record CASCADE + `service_history` SET NULL, applied to prod (7 at 0 orphans; `review_requests→bookings` had 4 test/sentinel rows with `bookingId` 0/99999 DELETED per operator confirmation, then FK added). Includes 2 **live** cascades where `bookings` is deleted (`review_requests`, `appointment_reminders`). Pairs: `customer_vehicles.userId→users` (CASCADE), `service_history.{userId→users, vehicleId→customer_vehicles, bookingId→bookings}` (SET NULL), `review_requests.bookingId→bookings` (CASCADE), `winback_sends.customerId→customers` (CASCADE), `sms_campaign_sends.customerId→customers` (CASCADE), `appointment_reminders.booking_id→bookings` (CASCADE).

**Impossible FKs (type mismatch — cannot add, documented in schema.ts):**
- `invoices.workOrderId` (`int`) → `work_orders.id` (`varchar(36)`)
- `service_affinity_predictions.customer_id` (**`bigint` in DB**) → `customers.id` (`int`) — also a latent schema drift (Drizzle declares `int`).

### Waves 1–4/5 (31 FKs)

**Wave 4/5 (2026-07-07) added 19** — all pre-checked 0 orphans (pure additive, no data writes), types verified, applied to prod:
- **14 SET NULL** (optional/money-adjacent links): `leads.{callbackId→callback_requests, bookingId→bookings, invoiceId→invoices}`, `invoices.bookingId→bookings`, `estimates_log.{invoiceId→invoices, bookingId→bookings}`, `alg_estimates.{matched_invoice_id→invoices, customer_id→customers}`, `vapi_call_logs.{leadId→leads, callbackId→callback_requests}`, `payments.customer_id→customers`, `tire_orders.{customerId→customers, bookingId→bookings}`, `warranties.customer_id→customers`
- **4 RESTRICT** (protect records): `payments.invoice_id→invoices`, `loyalty_transactions.userId→users` (points ledger), `job_assignments.technicianId→technicians` (**technicians ARE deleted** — guards labor records), `warranties.work_order_id→work_orders`
- **1 CASCADE**: `job_assignments.bookingId→bookings`
- **Skipped:** `invoices.workOrderId→work_orders` — `int` vs `varchar(36)` type mismatch, no DB FK possible (kept as a soft link, noted in `schema.ts`).

### Waves 1–3 (12 FKs)

| Child.column | → Parent | ON DELETE | Note |
|---|---|---|---|
| `sms_messages.conversationId` | `sms_conversations.id` | CASCADE `[V]` | wave 1 (PR #602) · 0 orphans of 8,776 |
| `invoices.customerId` | `customers.id` | SET NULL `[V]` | wave 2 (PR #603) · 0 orphans of 2,792 |
| `inspection_items.inspectionId` | `vehicle_inspections.id` | CASCADE `[V]` | wave 3 · 0 orphans |
| `customer_metrics.customerId` | `customers.id` | CASCADE `[V]` | wave 3 · 0 orphans |
| `vehicles.customer_id` | `customers.id` | CASCADE `[V]` | wave 3 · 0 orphans |
| `work_order_items.work_order_id` | `work_orders.id` | CASCADE `[V]` | wave 3 · uuid FK · 0 orphans |
| `work_order_transitions.work_order_id` | `work_orders.id` | CASCADE `[V]` | wave 3 · uuid FK · 0 orphans |
| `qc_checklists.work_order_id` | `work_orders.id` | CASCADE `[V]` | wave 3 · uuid FK · 0 orphans |
| `prediction_impressions.prediction_id` | `service_affinity_predictions.id` | CASCADE `[V]` | wave 3 · bigint FK · 0 orphans |
| `prediction_actions.prediction_id` | `service_affinity_predictions.id` | CASCADE `[V]` | wave 3 · bigint FK · 0 orphans |
| `sms_orchestration_outcomes.orchestration_id` | `sms_orchestrations.id` | CASCADE `[V]` | wave 3 · 0 orphans |
| `work_orders.customer_id` | `customers.id` | SET NULL `[V]` | wave 3 · 1 orphan pointer NULLed (row preserved) |

## Deferred (blocked on a decision)

| Child.column | → Parent | Blocker |
|---|---|---|
| `*` phone10 unique index (BE-DATA-2) | — | data clean (0 collisions), but a unique index changes future write-failure semantics → needs a customer-insert-path audit first |

## Candidate waves (each row = pre-check then apply)

**Parents NEVER deleted in `server/` (customers, users, vehicles, work_orders)** → semantics are dormant
today; pick the correct one for when a purge is ever added.

**Wave 3 — high-confidence ownership (CASCADE):**
- `vehicles.customer_id → customers.id` (NN)
- `customer_metrics.customerId → customers.id` (NN, recomputable rollup)
- `inspection_items.inspectionId → vehicle_inspections.id` (NN)
- `work_order_items.work_order_id → work_orders.id` (NN)
- `work_order_transitions.work_order_id → work_orders.id` (NN)
- `qc_checklists.work_order_id → work_orders.id` (NN)
- `prediction_impressions.predictionId → service_affinity_predictions.id` (NN)
- `prediction_actions.predictionId → service_affinity_predictions.id` (NN)
- `sms_orchestration_outcomes.orchestrationId → sms_orchestrations.id` (NN)
- `review_requests.bookingId → bookings.id` (NN, bookings ARE deleted → cascade is live)
- `appointment_reminders.bookingId → bookings.id` (NN, bookings deleted)

**Wave 4 — optional links (SET NULL), incl. money-adjacent (never cascade):**
- `payments.customer_id → customers.id` · `payments.invoice_id → invoices.id` (**RESTRICT** — invoices ARE deleted; protect payment records)
- `leads.{callbackId,bookingId,invoiceId} → …` (all nullable, parents deleted)
- `vapi_call_logs.{leadId,callbackId} → …`
- `tire_orders.{customerId,bookingId} → …`
- `invoices.{bookingId,workOrderId} → …`
- `estimates_log.{bookingId,invoiceId} → …`
- `alg_estimates.{matched_invoice_id,customer_id} → …`
- `warranties.{customer_id,work_order_id} → …` (work_order → **RESTRICT**, warranty is a liability record)
- `communication_log`, `service_history`, `customer_status_messages`, `chat_analytics.sessionId`, `conversation_memory.sessionId`

**Wave 5 — protect (RESTRICT):**
- `loyalty_transactions.userId → users.id` (points ledger — financial)
- `job_assignments.technicianId → technicians.id` (**technicians ARE deleted, db.ts:1501** — RESTRICT blocks deleting a tech with live assignments)

Full machine-readable candidate set (97 rows, per-pair rationale + confidence): workflow `wf_44b63fe3-b5f`.

_Clarity Gate: REVIEWED (2026-07-07). Shipped rows verified against prod; candidate rows are agent-mapped
leads that each require a pre-check before apply. No candidate is applied by reading this doc — the
per-pair orphan pre-check is mandatory._
