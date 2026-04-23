# ALG Estimate Sync — Sprint Plan

Status: **DESIGN COMPLETE, IMPL DEFERRED** (2026-04-22).
Blocker: requires a new ShopDriver API call wired behind shop-protection,
plus a schema migration for a dedicated table. Worth its own focused sprint.

---

## The business truth this unlocks

In ALG / ShopDriver Elite, an **estimate** = a customer walked in, got a
physical quote from the shop, and **did not get the work done**. That is
a **declined sale** — a lost opportunity worth recovery.

An **invoice** = completed work, money collected. A WIN.

The conversion metric Nour cares about is:

```
conversion = matched_invoices / total_alg_estimates
```

An ALG estimate WITHOUT a matching invoice from the same customer within
a reasonable window (7d / 30d) = declined work that could be recovered
with a follow-up call or SMS.

---

## What's broken today

1. **We don't pull ALG estimates.** `server/services/shopDriverMirror.ts`
   fetches invoices + tickets. Estimate endpoints are probed at line 1289
   (`/api/Estimate/listEstimates`) but never called in any sync path.

2. **`admin-stats.ts` "estimates" count is a lie.** It counts *website
   leads* where our AI classified a `recommendedService`. That's a
   totally different population:
   - Website leads = people who filled out a form online
   - ALG estimates = people who PHYSICALLY walked in and got a quote

3. **"Conversion rate" is apples-to-oranges.** Current formula is
   `invoices / (invoices + websiteLeads)` — comparing walk-in invoices
   to online lead volume. It's noise.

4. **No declined-work recovery engine exists.** We have
   `server/routers/declinedEstimates.ts` (admin section visible) but
   it reads from `estimates_log` which is AI-estimator-sourced, not
   ALG-sourced. The aggressive 7d / 30d follow-up documented in
   `business_vision.md` is blocked by this gap.

---

## Proposed implementation

### Phase 1 — Schema (1 migration, zero data risk)

```sql
CREATE TABLE alg_estimates (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  external_id         VARCHAR(50) NOT NULL UNIQUE,
  customer_name       VARCHAR(255) NOT NULL,
  customer_phone      VARCHAR(30),
  vehicle_info        VARCHAR(255),
  service_description TEXT,
  estimated_amount    INT NOT NULL DEFAULT 0,
  estimate_date       TIMESTAMP NOT NULL,
  -- Link to matched invoice if converted
  matched_invoice_id  INT NULL,
  matched_at          TIMESTAMP NULL,
  -- Recovery tracking
  follow_up_7d_sent   TINYINT(1) DEFAULT 0,
  follow_up_30d_sent  TINYINT(1) DEFAULT 0,
  recovery_note       TEXT,
  -- Sync metadata
  source              VARCHAR(32) DEFAULT 'alg',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_est_phone (customer_phone),
  INDEX idx_est_date (estimate_date),
  INDEX idx_est_unmatched (matched_invoice_id, estimate_date)
);
```

Drizzle schema addition (append to `drizzle/schema.ts`):

```ts
export const algEstimates = mysqlTable("alg_estimates", {
  id: int("id").autoincrement().primaryKey(),
  externalId: varchar("external_id", { length: 50 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 30 }),
  vehicleInfo: varchar("vehicle_info", { length: 255 }),
  serviceDescription: text("service_description"),
  estimatedAmount: int("estimated_amount").default(0).notNull(),
  estimateDate: timestamp("estimate_date").notNull(),
  matchedInvoiceId: int("matched_invoice_id"),
  matchedAt: timestamp("matched_at"),
  followUp7dSent: int("follow_up_7d_sent").default(0).notNull(),
  followUp30dSent: int("follow_up_30d_sent").default(0).notNull(),
  recoveryNote: text("recovery_note"),
  source: varchar("source", { length: 32 }).default("alg").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_est_phone").on(t.customerPhone),
  index("idx_est_date").on(t.estimateDate),
  index("idx_est_unmatched").on(t.matchedInvoiceId, t.estimateDate),
]);
```

### Phase 2 — Sync service (shop-protection-aware)

New file: `server/services/shopDriverEstimateSync.ts`

```ts
/**
 * runEstimateMirror()
 *   - Hits ShopDriver /api/Estimate/listEstimates with the mirror session
 *   - Upserts each estimate into alg_estimates by externalId
 *   - Sets matchedInvoiceId = invoices.id when a matching invoice exists
 *     (match by customerPhone + amount within ±10% + invoiceDate between
 *      estimateDate and estimateDate+30d)
 *   - Non-destructive — existing rows keep their follow-up flags
 *
 * Gating:
 *   - Wrap in runIfAdminActive({ jobName: 'shopdriver-estimate-mirror' })
 *     SAME shop-protection rules as the invoice mirror
 *   - 15-min cadence in the pulse tier
 */
```

### Phase 3 — Replace the lying stats

`server/admin-stats.ts`:
- Drop the `leads WHERE recommendedService IS NOT NULL` counts
- Replace with: `SELECT COUNT(*) FROM alg_estimates WHERE estimate_date >= X`
- Compute real conversion:
  `converted / total_alg_estimates_in_window * 100`

### Phase 4 — Declined Work Recovery Engine

- New cron: `declinedWorkRecovery` in `server/cron/jobs/`
  - Find `alg_estimates` where `matchedInvoiceId IS NULL` AND
    `estimateDate >= today - 30d`
  - Fire 7d follow-up SMS (if `follow_up_7d_sent = 0` AND age > 7d)
  - Fire 30d follow-up SMS (if `follow_up_30d_sent = 0` AND age > 30d)
  - Flag-gate behind `FEATURE_DECLINED_RECOVERY` env var for phased rollout
- Admin UI: expand the existing `DeclinedEstimatesSection.tsx` to read
  from `alg_estimates` instead of `estimates_log`, show dollar value
  of declined work ("$12,480 in lost sales this month, 18 recoverable")
- Copy pattern for SMS follow-ups:
  - Day 7: "Hey [name], we quoted you $X for [service]. Any questions?
    Offer still good, drop off this week."
  - Day 30: "Hey [name], your [service] was quoted $X a month ago. Car
    problems rarely fix themselves. Come in, we'll honor the quote."

### Phase 5 — Bridge contract v11.3

Update `docs/NICKSTIRE-QUERY-CONTRACT.md`:
- `estimates-conversion` endpoint: add `scope: "alg"` option that
  reads from `alg_estimates` instead of `estimates_log`
- `estimates-aging` endpoint: same — filter by ALG scope
- Statenour dashboards display "WALKED BUT DIDN'T BUY" count + dollar
  value as a top-line metric

---

## Timing estimate

- Phase 1 (schema): 20 min — pure additive CREATE TABLE, low risk
- Phase 2 (sync service): ~3 hr — the ShopDriver estimate endpoint
  shape is unknown; needs exploratory probe first
- Phase 3 (stats fix): 1 hr — straightforward swap
- Phase 4 (recovery engine): ~2 hr — cron + UI + SMS templates
- Phase 5 (bridge contract): 30 min

**Total: ~7 hours focused sprint.**

---

## Prereqs before starting

1. **Confirm ShopDriver estimate endpoint shape.** Run the
   `alg-auto-discovery` cron (already exists, admin-triggered) and
   capture the response from `/api/Estimate/listEstimates`. That tells
   us what fields are available before we design the schema mapping.

2. **Stage / test env.** Follow the pattern from
   `docs/operations/SCHEMA-MIGRATION-PLAN.md` — don't run the
   Phase 1 migration blind in prod.

3. **Confirm business rule on matching.** "Matched invoice" heuristic
   above (phone + amount ±10% + date within 30d) should get Nour's
   sign-off. Different matching rule → different numbers.

---

## Ship trigger

Ship when:
- The ALG estimate endpoint shape is confirmed via discovery probe, AND
- A staging env exists (per SCHEMA-MIGRATION-PLAN.md), AND
- Nour confirms the matching rule

Until then, UI labels correctly disclose that "estimates" in our
dashboards = AI-classified website leads, NOT ALG walk-in quotes.
