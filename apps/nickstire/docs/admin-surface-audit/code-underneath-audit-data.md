# Code-Underneath Audit — Data + Services Layer

**Scope:** `server/services/**`, `drizzle/schema.ts`, plus the cron jobs and routers that
write/read the customer-metrics spine. Read-only audit (no code or DB changes).
**Stance:** kaizen · clarity-gate · DATABASE-ARCHITECT (access patterns, FK integrity, data quality).
**Date:** 2026-06-03 · `nickstire-admin-audit` worktree.
**Method:** reverse-tracked the customer/invoice/work-order/metrics relationships UI→service→schema,
confirmed each finding at file:line, and flagged what *looks* wrong but is correct-by-design.

Classification legend: **CORRECTNESS** · **PERF** · **STALENESS** · **DEAD** · **DATA-INTEGRITY** · **SECURITY**.
Confidence: **CONFIRMED** (proven at file:line) vs **INFERRED** (strong reasoning, not runtime-proven).

---

## TL;DR — Top 10 by leverage

| # | Finding | Class | Sev | Conf | Where |
|---|---------|-------|-----|------|-------|
| 1 | **`getTrackingInfo` auth bypass** — phone verification is nested in `if(!isNaN(custId))`; walk-in / AI-chat WOs have a non-numeric `customer_id` (`"WALK-IN"` / phone), so `parseInt`→NaN skips the check and returns full tracking by order-number alone. Order numbers are low-entropy `WO-{Date.now().toString(36)}`. | SECURITY / DATA-INTEGRITY | **Critical** | CONFIRMED | `services/customerMessaging.ts:162-180` + `routers/nick/actions.ts:150,155` |
| 2 | **`work_orders.customer_id` is a polluted varchar space** — `customers.id` is `int`, but `nick/actions.ts:150` writes `customerData.phone` or the literal `"WALK-IN"`. Every `CAST(c.id AS CHAR)=w.customer_id` reconciliation join MISSES those rows → backlog metrics undercount; declined-recovery can't text those customers (`phone=""`). | DATA-INTEGRITY | **High** | CONFIRMED | `routers/nick/actions.ts:150,155` · `services/customerMetricsRefresh.ts:82` · `dataPipelines.ts:230` · `declinedWorkRecovery.ts:92` |
| 3 | **`customers.segment` has 3 writers on 3 cadences with divergent logic** — enrich step-7 (`dataPipelines.ts:459`, runs with enrich cron) + weekly recency cron (`cron/jobs/customerSegmentation.ts`) + manual admin override (`customers.ts:672`). Last-writer-wins → the "false healthy" churn divergence. The rich 10-segment `segmentCustomer()` taxonomy can't even fit the 4-value enum. | STALENESS / DATA-INTEGRITY | **High** | CONFIRMED | `dataPipelines.ts:459` · `cron/jobs/customerSegmentation.ts:20-48` · `routers/customers.ts:672` |
| 4 | **`customer_metrics.totalRevenue / totalJobs / avgSpendPerVisit / daysSinceLastVisit / predictedNextVisit` are NEVER written** — only seeded to 0 on INSERT; `customers.list` SELECTs and returns them anyway (always 0/null). The refresh writes only declined/backlog; `intelligenceEngines` writes only churnRisk/isVip. *(Note: totalRevenue reads in `vipLookup` and `customerPsychoProfile` have been redirected to `customers.totalSpent` to resolve false zeros.)* | DEAD / CORRECTNESS | **High** | CONFIRMED | `customerMetricsRefresh.ts:39-86` · `routers/customers.ts:161-164` · `services/customerPsychoProfile.ts` |
| 5 | **`enrichCustomerData` spend/visit match uses the WEAK phone join** `RIGHT(c.phone,10)=RIGHT(i.customerPhone,10)` (no digit-strip) while `customerMetricsRefresh` uses the HARDENED `RIGHT(REGEXP_REPLACE(...),10)`. E.164/punctuated invoice phones mis-slice → `totalSpent`/`totalVisits`/`firstVisitDate` silently undercounted; two surfaces compute spend by different rules. | CORRECTNESS / PERF | **High** | CONFIRMED | `dataPipelines.ts:379,392,405` vs `customerMetricsRefresh.ts:55,63` |
| 6 | **`churnRisk`/`isVip` are refreshed for only the top-200 customers** — `predictCustomerLTV` writes `scored.slice(0,200)`; everyone else keeps the seeded `churnRisk='low'`/`isVip=0` forever. The `hasBacklog`/`hasDeclined`/churn UI reads stale 'low' for the long tail. | STALENESS | **Med-High** | CONFIRMED | `services/intelligenceEngines.ts:559,568-570` |
| 7 | **Revenue is computed inconsistently across surfaces** — paid-only vs all-status, by-phone vs by-name, cents-handling, and a `LIMIT 5000` truncation. Same "revenue" number differs by which endpoint renders it. | CORRECTNESS | **Med** | CONFIRMED | `routers/customers.ts:256-263` (no paid filter) vs `dataPipelines.ts:574-603` (paid) · `customerIntelligence.ts:64-67` (LIMIT 5000, by-name) |
| 8 | **Unmatched ALG estimates with no phone can NEVER match an invoice** — `upsertEstimates`/`backfillMatches` only attempt a match `if (est.customerPhone)`. No-phone walk-in estimates stay "declined work" permanently even after the customer pays → inflates the declined-$ figure. | DATA-INTEGRITY | **Med** | CONFIRMED | `services/shopDriverEstimateSync.ts:773,873` |
| 9 | **All customer↔invoice/lead joins are function-wrapped on the indexed column** (`RIGHT(REGEXP_REPLACE(phone…))`), defeating `idx_invoice_customer_phone` / `uniq_customer_phone` → full scans on every enrich/metrics/intelligence pass and the `advancedStats`/`topSpenders` page query. | PERF | **Med** | CONFIRMED | `dataPipelines.ts`, `customerMetricsRefresh.ts`, `routers/customers.ts:274`, `engines/*` |
| 10 | **`syncVisitDatesFromInvoices` uses MySQL `UPDATE … INNER JOIN` with an operator-precedence trap** — `WHERE a < b AND c >= 10` mixes the join freshness guard and the length guard without parens; `AND` binds tighter than the intended grouping, so the length guard narrows the *freshness* predicate, not the row set. | CORRECTNESS | **Med** | INFERRED | `services/dataPipelines.ts:216-217` |

**Single highest-leverage fix:** **#1 (`getTrackingInfo` auth bypass).** It is the only finding that
is both a live security hole (customer PII/job data exposed by guessable order number) and a direct
symptom of the #2 root cause (`work_orders.customer_id` polluted with non-int sentinels). Fix the
verification to fail-closed when `customer_id` is non-numeric (and resolve walk-in WOs by the stored
phone instead), and you close the exposure *and* expose the underlying integrity defect to fix next.

---

## Area 1 — `work_orders.customer_id` integrity (the join that mostly misses)

**Root cause.** `work_orders.id` and `.customer_id` are `varchar(36)` (`schema.ts:1905,1907`), but
`customers.id` is `int autoincrement` (`schema.ts:950`). Two writers create work orders:

- `services/workOrderService.createWorkOrder` (`workOrderService.ts:137-157`) writes `params.customerId`
  — callers pass a stringified customer int. OK.
- `routers/nick/actions.ts:182` writes `workOrderData.customerId = resolvedCustomerId`, where
  `resolvedCustomerId = input.customerId || (customerData?.phone ? customerData.phone : "WALK-IN")`
  (`actions.ts:149-150`). **So `customer_id` legitimately holds raw phone strings and the literal
  `"WALK-IN"`.**

Every reconciliation that joins WOs to customers therefore relies on `customer_id` parsing/casting to an int:

| Consumer | Join / parse | Effect when `customer_id` is phone/"WALK-IN" |
|---|---|---|
| `customerMetricsRefresh.ts:82` | `w.customer_id = CAST(c.id AS CHAR)` | row never joins → **backlogValueCents/backlogCount undercount** |
| `dataPipelines.ts:230` (`syncVisitDatesFromInvoices` WO arm) | `c.id = CAST(wo.customerId AS UNSIGNED)` | `CAST('WALK-IN' AS UNSIGNED)=0` → joins nothing (or row id 0) |
| `invoiceReconciliation.ts:62` | `parseInt(wo.customerId,10)` | NaN → customer name blank |
| `customerMessaging.ts:89,163` | `parseInt(wo.customerId,10)` | NaN → no recipient / **auth bypass (Area 6)** |
| `declinedWorkRecovery.ts:92` | `parseInt(wo.customerId,10)` | NaN → `phone=""` → **declined-recovery SMS silently undeliverable** |
| `dropOffFlow.ts:40` | `parseInt(wo.customerId,10)` | NaN → drop-off flow skips |
| `workOrderService.ts:168,339,365` | `parseInt(wo.customerId,10)` | NaN → name resolution falls back to raw id string |

**Quantify the impact:** the share of WOs created via the AI-chat path (`nick/actions.ts`) for
walk-ins with no `input.customerId` = the share of WOs invisible to backlog metrics and unreachable by
declined-recovery. (Needs a `SELECT COUNT(*) FROM work_orders WHERE customer_id NOT REGEXP '^[0-9]+$'`
to put a number on it — out of scope for this read-only pass, but that one query sizes findings #1, #2, #11.)

**Proposed fix (design, not applied):**
1. In `nick/actions.ts`, resolve/create a real `customers` row (via `findOrCreateCustomer`, which already
   exists in `customerLookup.ts`) before insert, and write the **int id** into `customer_id`. Never write
   a phone or `"WALK-IN"` sentinel into a column the whole reconciliation layer treats as a customer id.
2. For the legacy polluted rows: a one-time backfill that, where `customer_id` is non-numeric, matches the
   stored phone to `customers` by last-10 (reuse the hardened `RIGHT(REGEXP_REPLACE…)` pattern) and rewrites
   `customer_id` to the int; leave genuinely anonymous walk-ins as a single explicit sentinel id (e.g. a
   reserved customer row) rather than free-text.
3. Add a CHECK-style guard or a typed helper so future writers can't put non-ids there.

---

## Area 2 — `customers.segment` staleness & the "false healthy" divergence

**Three writers, three cadences, divergent logic** (CONFIRMED):

1. **Enrich step 7** — `dataPipelines.ts:459-475`. Logic: `lastVisitDate>=90d→recent`,
   `>=365d→lapsed`, `totalVisits<=1 AND lastVisitDate IS NULL→new`, else `unknown`. Runs on the enrich
   cron (`scheduler.ts:727`).
2. **Weekly recency cron** — `cron/jobs/customerSegmentation.ts:20-48`. Pure recency:
   `<=90→recent`, `91-365→lapsed`, `>365→unknown`, `lastVisitDate IS NULL→new`. Registered at
   `scheduler.ts:589,926` and `cron/index.ts:400`.
3. **Manual admin override** — `customers.ts:672` (`d.update(customers).set({segment: input.segment})`).

They **mostly** agree but diverge on the `new` bucket: enrich requires `totalVisits<=1 AND lastVisitDate
IS NULL`; the weekly cron calls *any* null-`lastVisitDate` row `new` regardless of `totalVisits`. Because
both crons write the same column, **whichever ran most recently wins** — segment is non-deterministic for
analytics, and a customer who churned per live `lastVisitDate` can read `recent` until the next cron pass.
That is the "false healthy" the operator flagged. (The operator's framing — "refreshed only by
enrich/login" — is slightly off: the weekly recency cron is the *primary* writer; there is no login-path
writer. The divergence is real and is between the two crons, not enrich-vs-nothing.)

**Bonus (DEAD-ish):** `services/customerSegmentation.segmentCustomer()` computes a far richer 10-value
taxonomy (`vip/loyal/growing/one-timer/at-risk/churned/fleet/new/referrer/price-sensitive`,
`customerSegmentation.ts:9-80`) but its only consumers are the `segments` tRPC probe (`segments.ts:21`,
input-driven, persists nothing) and `customerPsychoProfile.ts:114`. It **never writes `customers.segment`**
(can't — the enum is 4 values). So the shop's "real" segmentation engine is decorative w.r.t. the column
the admin list filters on.

**Subtle (likely benign):** the enrich step-7 SET-CASE has a 4th branch
(`WHEN lastVisitDate IS NOT NULL THEN 'unknown'`) that the WHERE-comparison CASE omits
(`dataPipelines.ts:461-474`). Traced through: a non-null date >365 hits neither of the first two branches
in either CASE, so both resolve to `'unknown'` → no actual divergence. Noting it because it *looks* like a
mismatch on read and is a maintenance trap.

**Proposed fix:** pick ONE segment writer (the weekly recency cron is the clean one), delete the enrich
step-7 segment block, and either (a) widen consumers to read churn from `customer_metrics.churnRisk`
(live-ish) instead of `customers.segment`, or (b) recompute segment inside `refreshCustomerMetrics` so
"churn signal" and "segment" share a cadence and source.

---

## Area 3 — `customer_metrics` dead columns & partial refresh

`customer_metrics` (`schema.ts:1149-1182`) defines 9 metric columns. Writer coverage (CONFIRMED via grep
of every `.set(`/`UPDATE customer_metrics`/`INSERT INTO customer_metrics`):

| Column | Written by | Status |
|---|---|---|
| `declinedValue`, `declinedCount` | `customerMetricsRefresh.ts:65-67` | OK (cron) |
| `backlogValueCents`, `backlogCount` | `customerMetricsRefresh.ts:83-85` | OK (cron, but Area 1 undercount) |
| `churnRisk`, `isVip` | `intelligenceEngines.ts:570` + `crudAutomation.ts:592` (isVip) | **top-200 only** (Area, #6) |
| `totalRevenue` | — | **DEAD (partially resolved)**: was seeded 0 and never updated in `customer_metrics`. Reads in `vipLookup` and `customerPsychoProfile` have been redirected to `customers.totalSpent` to fetch live spent data. |
| `totalJobs` | — | **DEAD: seeded 0, never updated** |
| `avgSpendPerVisit` | — | **DEAD: seeded 0, never updated** |
| `daysSinceLastVisit` | — | **DEAD: nullable, never written** |
| `predictedNextVisit` | — | **DEAD: nullable, never written** |

`routers/customers.ts:161-164` SELECTs `totalRevenue`, `avgSpendPerVisit`, `daysSinceLastVisit`,
`churnRisk`, `isVip` into the admin customer list. The other dead metrics are returned as constant 0/null.
`vipLookup` and `customerPsychoProfile` redirected their `totalRevenue` reads to `customers.totalSpent` (cents spent).

**Proposed fix:** either populate the remaining dead fields in `refreshCustomerMetrics` (they're trivially derivable from the
same invoice aggregates the enrich step already computes), or drop them from the SELECT and the schema.
Don't ship columns the UI reads but nothing writes.

`churnRisk`/`isVip` top-200 cap (`intelligenceEngines.ts:559` `scored.slice(0,200)`,
`:568-570`): the long tail keeps the INSERT-seeded `'low'`/`0`. For a ~2,500-customer DB that's ~2,300
customers with permanently stale churn. Fix: chunk-update **all** scored rows (the chunk loop at :565-571
already handles arbitrary size; the `.slice(0,200)` at :559 is the artificial cap), or compute churn
set-based in SQL like the declined/backlog steps.

---

## Area 4 — phone-match correctness & perf (two patterns, one weak)

Two phone-join idioms coexist repo-wide:

- **Hardened** `RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)` — strips `+1`, spaces, punctuation. Used in
  `customerMetricsRefresh.ts:55,63`, `customerLookup.ts:41`, `declinedWorkRecovery cron:279`,
  `voiceAgent.ts:662,735`, `crossSellOutreach.ts:182`.
- **Weak** `RIGHT(c.phone,10)=RIGHT(i.customerPhone,10)` — no strip. Used in **`enrichCustomerData`
  steps 1-3** (`dataPipelines.ts:379,392,405`) and `engines/growth.ts:332`, `engines/marketing.ts:28`,
  `engines/customer.ts:352-354`.

**Why it's a correctness bug (CONFIRMED):** `shopDriverMirror` stores `invoices.customerPhone` raw from
ALG (`shopDriverMirror.ts:916`), which can be E.164 `+12165551234`. `RIGHT('+12165551234',10)` =
`'2165551234'`? No — it's `'2165551234'` only if exactly 10 trailing chars are digits; for
`+1 (216) 555-1234` the last 10 chars include punctuation, so the slice is garbage and the join misses.
`customers.phone` is stored last-10 canonical (`customerLookup.ts:92`), so a canonical-vs-E.164 pair fails
the weak join but passes the hardened one. **Net: `enrichCustomerData` undercounts `totalSpent`/
`totalVisits`/`firstVisitDate` for exactly the customers whose invoice phone wasn't pre-normalized**, while
`customerMetricsRefresh` (declined/backlog) counts them — so two adjacent metrics on the same customer card
are computed by different match rules. This is the same bug class already fixed in `smsInstrumentation.ts`
(see its own 2026-06 bug-fix comment at :65-71) but never propagated to enrich.

**Perf (CONFIRMED):** every one of these joins wraps the indexed `phone`/`customerPhone` column in a
function, so MySQL can't use `idx_invoice_customer_phone`, `uniq_customer_phone`, etc. → full scans on the
enrich cron, the metrics refresh, the intelligence passes, and the `advancedStats` top-spenders query
(`customers.ts:274`). At ~2,500 customers × invoice volume this is tolerable today but is O(N×M) and the
top-spenders query runs on an admin page load, not a cron.

**Proposed fix:** (1) make enrich use the hardened pattern (consistency + correctness, behavior-additive —
it can only *find more* matches). (2) Longer-term, the real fix per the existing `customer-dedup-plan.md`
is to store ONE canonical phone form everywhere and join on raw equality so the index is usable; migration
`0064_sms_phone_normalize_merge` already started this for SMS — extend it to `invoices.customerPhone`.

---

## Area 5 — revenue computed inconsistently across surfaces

| Surface | Filter | Key | Notes |
|---|---|---|---|
| `getDailyRevenueTruth` (`invoiceReconciliation.ts:177-188`) | `paymentStatus='paid'` | date | cents-correct, the documented source of truth |
| `processRevenueAnalytics` (`dataPipelines.ts:574-603`) | `paid` | date | cents-correct |
| `customers.advancedStats.revenueSummary` (`customers.ts:253-263`) | **NO paymentStatus filter** | date | counts pending/partial/refunded as revenue → **overstates vs the "truth" function** |
| `customerIntelligence` (`customerIntelligence.ts:64-67`) | `paid` | **by `customerName` string**, **`LIMIT 5000`** | name-collisions merge distinct customers; >5000 paid invoices/yr silently truncates; `avgLTV` divides 12-mo revenue by **all-time** customer count then labels it "lifetime value" |

**Proposed fix:** centralize a single `paidInvoiceRevenue(period)` helper (paid-only, cents→dollars,
phone-keyed, no row cap) and have all four surfaces call it. The `advancedStats` missing-paid-filter is the
one most likely to read as "false healthy" (revenue looks higher than the cash that actually came in).

---

## Area 6 — `getTrackingInfo` IDOR / auth bypass (SECURITY, Critical)

`services/customerMessaging.ts:154-220`. Flow:

```
const [wo] = ... where(orderNumber = ?)          // L158: anyone with an order number
try {
  const custId = parseInt(wo.customerId, 10);     // L163
  if (!isNaN(custId)) {                            // L164 — guard
    const [cust] = ... where(id = custId);
    if (!cust) return null;
    if (normalize(cust.phone) !== normalize(phone)) return null;   // the ONLY auth check
  }
} catch { ... return null; }                       // transient-error path (hardened earlier)
... return { orderNumber, status, vehicle, services, promisedAt, ... };   // L209
```

When `wo.customerId` is `"WALK-IN"` or a phone string (written by `nick/actions.ts:150` for AI-chat-created
walk-in WOs), `parseInt`→`NaN`, the `if (!isNaN)` block is **skipped entirely**, and control falls through
to the unconditional `return` at L209. **The caller's `phone` argument is never checked against anything.**
So for any walk-in / AI-chat work order, the public tracker returns status + vehicle + service list +
promised time to anyone who supplies the order number — no phone proof required.

Order numbers are `WO-${Date.now().toString(36).toUpperCase()}` (`nick/actions.ts:146`) — millisecond
timestamps in base36, i.e. monotonic and low-entropy. An attacker who saw one valid order number can walk
nearby timestamps. This is a textbook IDOR.

**Proposed fix:** fail-closed. If `Number.isNaN(custId)`, `return null` (or resolve the walk-in WO's owner
by its stored phone and verify against that) BEFORE the return. Tie this to the Area-1 fix that stops
writing non-ids into `customer_id` in the first place.

---

## Area 7 — silent failures & smaller correctness items

| Item | Class | Sev | Conf | Where |
|---|---|---|---|---|
| `syncVisitDatesFromInvoices` precedence trap — `WHERE c.lastVisitDate IS NULL OR c.lastVisitDate < i.latestInvoice AND LENGTH(...)>=10`. `AND` binds tighter than `OR`, so the length guard only constrains the second OR-branch; null-`lastVisitDate` rows bypass the length guard. Likely benign (length already enforced in the join) but the predicate doesn't mean what it reads as. | CORRECTNESS | Med | CONFIRMED | `dataPipelines.ts:216-217` |
| `winbackProcessor` flag-off path `continue`s without counting — when `sms_retention_sequences` is off, the loop iterates all pending rows doing nothing, `skipped` not incremented, returns "0 sent" with no signal that N rows were gated. Rows correctly stay `pending`. Cosmetic but the return detail misleads. | CORRECTNESS | Low | CONFIRMED | `winbackProcessor.ts:64-67` |
| Telegram/`remember` side-effects in data pipelines swallow errors with `log.warn` only (by design — must not break the pipeline) — acceptable, but note the pipelines' **only** durable output of their analytics is a `nickMemory.remember()` insight string; there's no metrics table, so "revenue analytics" / "tire intelligence" are not queryable, only re-derivable. | DEAD-ish | Low | CONFIRMED | `dataPipelines.ts:318-329,533-542,629-635` |
| `analyzeTireInventory` reads `priceCache` (in-memory Map, `dataPipelines.ts:39`) for low-stock — cache is process-local and empty after a deploy/restart until `refreshGatewayPrices` runs, so low-stock alerts silently no-op on a cold process even though the function reports success. | STALENESS | Low | CONFIRMED | `dataPipelines.ts:521-530` |
| `estimatesLog` table (`schema.ts:1254`) — separate from `alg_estimates`; verify it still has writers (conversion-rate tracking) or it's a dead analytics table. (Not traced this pass — flag for a follow-up grep.) | DEAD? | Low | INFERRED | `schema.ts:1254-1286` |

---

## Verify-don't-trust — things that LOOK wrong but are correct-by-design

- **`smsInstrumentation.ts` phone match** — *looks* like the weak `RIGHT(REPLACE…)` pattern in the
  comments, but the code (`:72-77,138-143`) actually does an **indexed `inArray([phone10, normalized])`**
  exact match against both stored forms. Already hardened in 2026-06. Not a bug. (This is the model the
  enrich steps should copy.)
- **`enrichCustomerData` "reset to 0 then SET"** (`dataPipelines.ts:366-369`) — looks destructive, but it's
  a deliberate idempotency pattern (SET-not-ADD) so re-running the cron is safe. Correct.
- **`getDailyRevenueTruth` queries `invoices` not `work_orders`** — looks like it ignores the WO workflow,
  but that's the documented 2026-04-24 source-of-truth shift (`invoiceReconciliation.ts:150-156`): ALG
  invoices are the revenue truth; WOs are internal state. Correct.
- **`findOrCreateCustomer` catches Duplicate-entry and re-finds** (`customerLookup.ts:107-117`) — looks like
  a swallowed insert error, but it's the wave-116 race-safe pattern against the `uniq_customer_phone`
  constraint. Correct.
- **`customer_metrics.churnRisk` vs `customers.segment` being separate** — looks like duplication, but they
  ARE intentionally different axes (churn-risk tier vs recency bucket). The bug isn't that they're separate;
  it's that `segment` has divergent writers (Area 2) and the long tail of `churnRisk` is stale (Area 3).
- **`algEstimates.followUp{3,7,14,30,45}d` 15-column spread** — looks like column bloat, but it's the
  documented at-most-once claim ledger (`schema.ts:1348-1372`); per-tier columns are required so a failed
  early tier doesn't block a later send. Correct-by-design.

---

## Suggested fix order (leverage × safety)

1. **#1 `getTrackingInfo` fail-closed** — tiny, safe, closes a live PII exposure. Ship first.
2. **#5 enrich → hardened phone pattern** — behavior-additive (only finds more matches), fixes the spend
   undercount, aligns enrich with metricsRefresh. Low risk.
3. **#2 stop writing non-ids into `work_orders.customer_id`** (`nick/actions.ts` resolve real customer id)
   + backfill — fixes backlog undercount AND declined-recovery deliverability AND is the root of #1.
4. **#3 collapse to one segment writer** — delete enrich step-7 segment block; keep the weekly recency cron.
5. **#4/#6 populate or drop the dead `customer_metrics` numerics; uncap churn refresh** — kills false-zero
   columns and stale churn.
6. **#7 centralize `paidInvoiceRevenue()`** — one revenue definition across all four surfaces.

All findings are read-only observations; nothing in this audit was applied.
