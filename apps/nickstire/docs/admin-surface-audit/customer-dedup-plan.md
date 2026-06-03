# Customer Dedup Plan — `customers` table

> **REVIEW + SIZE BEFORE EXECUTING — nothing in this document has been run.**
> Every block below is a proposal for operator review. No `UPDATE`/`DELETE`/`ALTER`/migration
> has been executed against any database. Dialect is **MySQL / TiDB** (nickstire's DB).
> Migrations here are **hand-applied SQL** (`apps/nickstire/CLAUDE.md` → "There is no auto-migrate").
>
> Stance: DATABASE-ARCHITECT — access patterns first, **backup + rollback before any destructive move.**

---

## 0. TL;DR

- **Symptom (operator-confirmed, prod, 2026-06-03):** the customers page shows the same person twice
  under different phone formats — "Aaron GEORGE" + "AARON GEORGE" ($3,105, 2010 FORD F150);
  "ROY HUTCHINSON" + "Roy Hutchinson" ($3,013, 2016 GMC ACADIA). "Total Customers" = 1,964, inflated.
- **Root cause (CONFIRMED):** there IS a unique constraint, but it is on the **raw `phone` string**
  (`drizzle/schema.ts:1004` `uniqueIndex("uniq_customer_phone").on(table.phone)`), and the various
  insert paths store phone in **inconsistent formats**. The same person stored as `+12165551234` and
  `2165551234` are two different strings → both satisfy the unique key → duplicate row. The wave-116
  dedup that preceded the constraint (`drizzle/0034_wave116_customer_phone_unique.sql`) grouped by
  **exact `phone`**, so any pair that differed by format was never collapsed and keeps re-accumulating.
- **Fix shape:** (1) size the problem (read-only), (2) merge on **normalized phone** (last-10-digits),
  repoint the true `customers.id` FK children, snapshot first, (3) re-point the unique key to a stored
  **normalized** phone column so re-creation is impossible, (4) normalize phone at every insert site.
- **Scope of a merge is smaller than it looks:** only **8 tables** truly FK to `customers.id`. The
  ShopDriver `customer_id` (varchar) space and the `users.id` loyalty space are **separate identities**,
  not children of `customers.id` (see §4).

---

## 1. Root-cause evidence (CONFIRMED file:line)

### 1a. The unique key is on the raw string
`drizzle/schema.ts:949-1010` — `customers` table:
- `phone: varchar("phone", { length: 30 }).notNull()` (line 953)
- `uniqueIndex("uniq_customer_phone").on(table.phone)` (line 1004)

`drizzle/0034_wave116_customer_phone_unique.sql:62` — `ALTER TABLE customers ADD UNIQUE KEY uniq_customer_phone (phone);`
The migration's own dedup guidance (lines 16-21, 28-54) groups by `phone` **exactly**
(`GROUP BY phone HAVING dupes > 1`) — so two rows with the same person but different phone *formats*
were **never** considered duplicates, survived the wave-116 cleanup, and the constraint happily admits both.

### 1b. Insert paths store phone in DIFFERENT formats

| Path | file:line | What it stores as `phone` |
|---|---|---|
| ShopDriver CSV import | `server/routers/shopdriver.ts:446` | `normalizePhone(rawPhone)` → **10 digits**, no country code |
| ShopDriver API sync | `server/routers/shopdriver.ts:707` | `normalizePhone(rawPhone)` → **10 digits** |
| Nick bulk CSV import | `server/routers/nick/intelligence.ts:675` | `(...).replace(/\D/g,"")` → **raw digits** (could be 10 OR 11) |
| ShopDriver mirror | `server/services/shopDriverMirror.ts:709` (`rc.phone`, normalized at `:639-644` to 10 digits) | **10 digits** |
| **Chat / booking find-or-create** | `server/services/customerLookup.ts:83-88` | **`data.phone` RAW** — whatever the caller passed, typically **E.164 `+1…`** |

`server/services/shopDriverMirror.ts:639-644` `normalizePhone`:
```js
const digits = raw.replace(/\D/g, "");
if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);   // → 10 digits
return digits;
```
`server/services/customerLookup.ts:30` looks up by `LIKE %<last10>` (so it *finds* a 10-digit row),
but on miss it **inserts `data.phone` verbatim** (`:86`). A chat caller passing `+12165551234` therefore
creates a NEW row even though `2165551234` already exists — the `LIKE` match and the unique key disagree
about what "the same phone" means. **This is the dominant dupe factory.** The CSV/API paths are
internally consistent (all 10-digit) but collide with the E.164 rows that chat/booking created.

> **Why the existing enrichment masks it:** `enrichCustomerData` (`server/services/dataPipelines.ts:372-408`)
> sums spend/visits by `RIGHT(c.phone,10) = RIGHT(i.customerPhone,10)`. Both a `+1…` row and a `2165…`
> row for the same person match the SAME invoices → **both rows get the full lifetime total**
> (hence "Aaron GEORGE" and "AARON GEORGE" each show $3,105 — not split, *duplicated*). That also
> double-counts toward the page's "avg lifetime per customer" and inflates `vipCount`
> (`server/routers/customers.ts:207` `SUM(CASE WHEN totalVisits >= 3 THEN 1 END)`).

---

## 2. (a) Sizing query — READ-ONLY (operator runs first)

> Pure `SELECT`. Run these to learn the scope **before** approving any merge. Nothing here writes.

### 2a-1. Dupe clusters by NORMALIZED phone (the real key)
```sql
-- How many normalized-phone clusters have >1 row, and how many extra rows that is.
SELECT
  COUNT(*)                       AS dupe_clusters,
  SUM(rows_in_cluster)           AS rows_in_dupe_clusters,
  SUM(rows_in_cluster - 1)       AS rows_that_would_be_merged_away
FROM (
  SELECT RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) AS phone10,
         COUNT(*) AS rows_in_cluster
  FROM customers
  WHERE phone IS NOT NULL
    AND CHAR_LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) >= 10
  GROUP BY phone10
  HAVING COUNT(*) > 1
) clusters;
```

### 2a-2. The actual dupe groups (eyeball the worst offenders)
```sql
SELECT
  RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) AS phone10,
  COUNT(*)                                       AS dupes,
  GROUP_CONCAT(id ORDER BY id)                   AS ids,
  GROUP_CONCAT(DISTINCT phone ORDER BY phone SEPARATOR ' | ')        AS phone_formats,
  GROUP_CONCAT(DISTINCT CONCAT_WS(' ', firstName, lastName) SEPARATOR ' | ') AS names,
  SUM(totalSpent)/100                            AS summed_spend_dollars,
  MAX(totalVisits)                               AS max_visits
FROM customers
WHERE phone IS NOT NULL
  AND CHAR_LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '')) >= 10
GROUP BY phone10
HAVING dupes > 1
ORDER BY dupes DESC, summed_spend_dollars DESC
LIMIT 200;
```

### 2a-3. Cross-check by name + vehicle (catches dupes where the phone10 ALSO differs,
e.g. a cell vs a landline). These are NOT auto-merged by the phone strategy — review by hand.
```sql
SELECT
  UPPER(TRIM(firstName))                 AS first_u,
  UPPER(TRIM(lastName))                  AS last_u,
  UPPER(TRIM(COALESCE(vehicleMake,'')))  AS make_u,
  UPPER(TRIM(COALESCE(vehicleModel,''))) AS model_u,
  COUNT(*)                               AS dupes,
  GROUP_CONCAT(id ORDER BY id)           AS ids,
  GROUP_CONCAT(DISTINCT phone SEPARATOR ' | ') AS phones
FROM customers
WHERE firstName IS NOT NULL AND lastName IS NOT NULL
GROUP BY first_u, last_u, make_u, model_u
HAVING dupes > 1
   AND COUNT(DISTINCT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)) > 1  -- only the ones phone10 missed
ORDER BY dupes DESC
LIMIT 200;
```

### 2a-4. Format histogram (confirms the diagnosis; shows how mixed the column is)
```sql
SELECT
  CASE
    WHEN phone LIKE '+1%'                              THEN 'E.164 (+1…)'
    WHEN phone REGEXP '^[0-9]{10}$'                    THEN '10 digits'
    WHEN phone REGEXP '^1[0-9]{10}$'                   THEN '11 digits (1…)'
    WHEN phone REGEXP '[^0-9]'                         THEN 'has punctuation'
    ELSE 'other'
  END AS fmt,
  COUNT(*) AS n
FROM customers
GROUP BY fmt
ORDER BY n DESC;
```

**Estimated scope (from code/evidence — operator must confirm with 2a-1):** "Total Customers" reads 1,964.
Dupes arise specifically where a chat/booking E.164 row coexists with a 10-digit import row for the same
person. The true count is **whatever 2a-1 returns as `rows_that_would_be_merged_away`** — likely tens to a
few hundred (every customer who both was imported AND interacted via chat/booking), not thousands. Do not
guess the post-merge total; read it from the query.

---

## 3. (b) Merge strategy

**Match key:** `phone10 = RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10)`, restricted to rows whose
digit-count ≥ 10 (shorter numbers are too ambiguous to auto-merge — leave them for the name+vehicle
hand review from 2a-3).

**Canonical survivor — pick the row that is most useful to keep, in this priority:**
1. **Most recent contact** — `MAX(COALESCE(lastVisitDate, updatedAt, createdAt))`. The customer's latest
   touch is the freshest contact info and the row the operator most likely already opened.
2. Tie-break: **most complete** — fewest NULLs across `email/address/city/state/zip/vehicleMake`.
3. Final tie-break: **lowest `id`** (oldest, stable, deterministic) — matches the wave-116 precedent
   (`0034_…sql:24` "keep the record with smallest id").

> Recommendation: keep it deterministic and auditable — **survivor = lowest `id` within the phone10
> cluster** (precedent + trivially reproducible), and **merge field values up** so the survivor ends up
> with the best of each column regardless of which row had it. This avoids "most-recent" edge cases where
> `lastVisitDate` is NULL on the newer row. The aggregate fields below make the survivor whole.

**Aggregation onto the survivor (per phone10 cluster):**
| Field | Rule | Why |
|---|---|---|
| `totalSpent` | recompute from invoices after merge (see §3 note) — do **not** SUM the duplicated values | both dupes already hold the full lifetime total (see §1b note); SUMming would double it |
| `totalVisits` | recompute from invoices after merge | same double-count risk |
| `lastVisitDate` | `MAX(lastVisitDate)` | latest known visit |
| `firstVisitDate` | `MIN(firstVisitDate)` | earliest known visit |
| `balanceDue` | `MAX(balanceDue)` (or recompute) | conservative; review |
| `email/phone2/address/city/state/zip` | `COALESCE(survivor, others)` — fill blanks only | never overwrite good data with NULL |
| `vehicleYear/Make/Model` | `COALESCE(survivor, others)` | keep whichever row had vehicle info |
| `alsCustomerId` | `COALESCE(survivor, others)` | preserve external linkage |
| `notes` | `COALESCE(survivor, others)` (or concatenate — operator choice) | don't lose operator notes |
| `smsOptOut` | `MAX(smsOptOut)` | **safety: if EITHER row opted out, the survivor stays opted out** (TCPA) |
| `smsCampaignSent` | `MAX(...)` | don't re-text someone already texted |
| `phone` | normalize the survivor to the canonical format (see §5; recommend **10-digit**, matching the import majority) | so the new unique key is satisfiable |

> **Spend/visits note:** the cleanest path is to NOT hand-merge `totalSpent`/`totalVisits` at all — just
> delete the losers, then run the existing idempotent enrichment (`server/services/dataPipelines.ts`
> → `enrichCustomerData`, exposed via the `customers.enrich` tRPC mutation at
> `server/routers/customers.ts:431`) which **SETs** spend/visits from the authoritative invoices by
> phone10. After the dupes are gone there is exactly one row per phone10 to receive the total. This is
> the YAGNI move — let the pipeline that already owns these numbers recompute them.

---

## 4. FK graph — what a merge must repoint (enumerated from `drizzle/schema.ts`)

A merge changes `customers.id`. Only tables that key off **`customers.id` (int)** must be repointed.

### 4a. TRUE children of `customers.id` (int) — **REPOINT THESE**
| Table | FK column | schema.ts | Null? | Notes |
|---|---|---|---|---|
| `customer_metrics` | `customerId` int | :1151 | NOT NULL | 1 row/customer; will collide → see §4c |
| `invoices` | `customerId` int | :1195 | nullable | also has `customerPhone`; many rows match by phone not id |
| `tire_orders` | `customerId` int | :1486 | nullable | also has `customerPhone` |
| `portal_sessions` | `customerId` int | :1411 | nullable | ephemeral; safe to repoint or ignore |
| `winback_sends` | `customerId` int | :1052 | NOT NULL | campaign send log |
| `sms_campaign_sends` | `customerId` int | :1681 | NOT NULL | campaign send log |
| `communication_log` | `customerId` int (`customer_id`) | :1759 | nullable | also has `customer_phone` |
| `payments` | `customerId` int (`customer_id`) | :1813 | nullable | also has `customer_phone` |

### 4b. NOT children of `customers.id` — **DO NOT repoint** (separate identity spaces — CONFIRMED)
- **ShopDriver `customer_id` varchar(36) space:** `work_orders.customer_id` (:1907), `vehicles.customer_id`
  (:1880), `warranties.customer_id` (:2061), `comebacks.customer_id` (:2652), `customer_status_messages.customer_id`
  (:2678), `push_subscriptions.customer_id` (:2499). **Evidence it is NOT `customers.id`:**
  `server/routers/nick/actions.ts:149-150` sets `work_orders.customerId = input.customerId || phone || "WALK-IN"`
  — a ShopDriver string / phone / sentinel, never `CAST(customers.id)`. The reconciliation joins
  (`customers.ts:739`, `customerMetricsRefresh.ts:82`) treat `work_orders.customer_id = CAST(customers.id AS CHAR)`
  as **best-effort** and mostly miss. Repointing them to a different int id would be wrong.
- **Customer-portal `users.id` space:** `customer_vehicles.userId` (:307), `service_history.userId` (:330),
  `loyalty_transactions.userId` (:595) reference `users` (the portal-account table), **not** imported `customers`.
- **`service_affinity_predictions.customer_id` bigint** (:2446): written by the ML cron keyed off its own
  customer source; verify before touching — out of scope for the phone-dupe fix.

### 4c. Phone-keyed tables — **self-heal after normalization, no repoint needed**
These match customers by phone string, not by id:
`review_requests.phone` (:658), `service_reminders` (phone), `sms_conversations` (phone),
`sms_messages` (phone), `drip_enrollments.customerPhone` (:2545), `memberships.phone` (:565),
`callback_requests.phone` (:620), `leads.phone`, `bookings.phone`, `call_events.phoneNumber`,
`vapi_call_logs.phoneNumber`, `alg_estimates.customer_phone` (:1338), `form_abandonment.phone`,
`waitlist.customer_phone`, `sms_preferences.phone` (:1780). Once §5 normalizes the stored phone on the
survivor, these continue to resolve by last-10 exactly as today.

### 4d. The `customer_metrics` collision (handle explicitly)
`customer_metrics.customerId` is effectively 1-row-per-customer (created by `customerMetricsRefresh.ts:39`).
Repointing a loser's metrics row to the survivor id would create **two** rows for the survivor. Cleanest:
**delete the losers' `customer_metrics` rows** and let `refreshCustomerMetrics` (tRPC
`customers.refreshMetrics` at `customers.ts:871`) rebuild from scratch — it INSERTs any missing row
(`customerMetricsRefresh.ts:39-44`). The §6 script does this.

---

## 5. (c) FK-repoint SQL (per phone10 cluster) — **PROPOSAL, do not run**

> Run inside a single transaction, **after** §6 backup. Uses a temp keeper-map so every child points
> at the surviving id. `START TRANSACTION` so a mid-run failure rolls back cleanly.

```sql
-- ──────────────────────────────────────────────────────────────────────
-- STEP A · build the keeper map: one survivor per phone10 cluster.
-- Survivor = lowest id in the cluster (deterministic; §3).
-- ──────────────────────────────────────────────────────────────────────
DROP TEMPORARY TABLE IF EXISTS _dedupe_map;
CREATE TEMPORARY TABLE _dedupe_map AS
SELECT c.id            AS loser_id,
       k.keep_id       AS keep_id
FROM customers c
JOIN (
  SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) AS phone10,
         MIN(id) AS keep_id
  FROM customers
  WHERE phone IS NOT NULL
    AND CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
  GROUP BY phone10
  HAVING COUNT(*) > 1
) k ON RIGHT(REGEXP_REPLACE(c.phone,'[^0-9]',''),10) = k.phone10
WHERE c.id <> k.keep_id;          -- losers only

-- Sanity: how many rows will be merged away (should equal sizing query 2a-1)
SELECT COUNT(*) AS losers, COUNT(DISTINCT keep_id) AS survivors FROM _dedupe_map;

START TRANSACTION;

-- ──────────────────────────────────────────────────────────────────────
-- STEP B · fill blanks on the survivor from its losers BEFORE repoint.
-- (COALESCE-up; never overwrites a non-null survivor value.)
-- ──────────────────────────────────────────────────────────────────────
UPDATE customers s
JOIN (
  SELECT m.keep_id,
         MAX(c.email)        AS email,    MAX(c.phone2)      AS phone2,
         MAX(c.address)      AS address,  MAX(c.city)        AS city,
         MAX(c.state)        AS state,    MAX(c.zip)         AS zip,
         MAX(c.vehicleYear)  AS vyear,    MAX(c.vehicleMake) AS vmake,
         MAX(c.vehicleModel) AS vmodel,   MAX(c.alsCustomerId) AS als,
         MAX(c.notes)        AS notes,
         MIN(c.firstVisitDate) AS first_visit,
         MAX(c.lastVisitDate)  AS last_visit,
         MAX(c.smsOptOut)      AS opt_out,        -- safety: sticky opt-out
         MAX(c.smsCampaignSent) AS sms_sent
  FROM _dedupe_map m JOIN customers c ON c.id = m.loser_id
  GROUP BY m.keep_id
) agg ON agg.keep_id = s.id
SET s.email        = COALESCE(s.email, agg.email),
    s.phone2       = COALESCE(s.phone2, agg.phone2),
    s.address      = COALESCE(s.address, agg.address),
    s.city         = COALESCE(s.city, agg.city),
    s.state        = COALESCE(s.state, agg.state),
    s.zip          = COALESCE(s.zip, agg.zip),
    s.vehicleYear  = COALESCE(s.vehicleYear, agg.vyear),
    s.vehicleMake  = COALESCE(s.vehicleMake, agg.vmake),
    s.vehicleModel = COALESCE(s.vehicleModel, agg.vmodel),
    s.alsCustomerId= COALESCE(s.alsCustomerId, agg.als),
    s.notes        = COALESCE(s.notes, agg.notes),
    s.firstVisitDate = LEAST(COALESCE(s.firstVisitDate, agg.first_visit), COALESCE(agg.first_visit, s.firstVisitDate)),
    s.lastVisitDate  = GREATEST(COALESCE(s.lastVisitDate, agg.last_visit), COALESCE(agg.last_visit, s.lastVisitDate)),
    s.smsOptOut      = GREATEST(s.smsOptOut, agg.opt_out),
    s.smsCampaignSent= GREATEST(s.smsCampaignSent, agg.sms_sent);

-- ──────────────────────────────────────────────────────────────────────
-- STEP C · repoint the TRUE customers.id (int) children (§4a).
-- customer_metrics is handled by DELETE (Step D), not repoint (§4d).
-- ──────────────────────────────────────────────────────────────────────
UPDATE invoices          t JOIN _dedupe_map m ON t.customerId = m.loser_id SET t.customerId = m.keep_id;
UPDATE tire_orders       t JOIN _dedupe_map m ON t.customerId = m.loser_id SET t.customerId = m.keep_id;
UPDATE portal_sessions   t JOIN _dedupe_map m ON t.customerId = m.loser_id SET t.customerId = m.keep_id;
UPDATE winback_sends     t JOIN _dedupe_map m ON t.customerId = m.loser_id SET t.customerId = m.keep_id;
UPDATE sms_campaign_sends t JOIN _dedupe_map m ON t.customerId = m.loser_id SET t.customerId = m.keep_id;
UPDATE communication_log t JOIN _dedupe_map m ON t.customer_id = m.loser_id SET t.customer_id = m.keep_id;
UPDATE payments          t JOIN _dedupe_map m ON t.customer_id = m.loser_id SET t.customer_id = m.keep_id;

-- ──────────────────────────────────────────────────────────────────────
-- STEP D · drop losers' metrics rows (rebuilt by refreshMetrics later, §4d)
-- and delete the loser customer rows.
-- ──────────────────────────────────────────────────────────────────────
DELETE cm FROM customer_metrics cm JOIN _dedupe_map m ON cm.customerId = m.loser_id;
DELETE c  FROM customers       c  JOIN _dedupe_map m ON c.id          = m.loser_id;

-- ──────────────────────────────────────────────────────────────────────
-- STEP E · normalize the SURVIVOR phone to canonical 10-digit
-- (matches the import majority; makes the new normalized unique key sane).
-- ──────────────────────────────────────────────────────────────────────
UPDATE customers
SET phone = RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)
WHERE CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
  AND phone <> RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10);

-- Verify zero remaining dupes, THEN commit. If anything looks wrong: ROLLBACK;
SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) AS phone10, COUNT(*) c
FROM customers GROUP BY phone10 HAVING c > 1;   -- expect 0 rows

-- COMMIT;     -- ← run only after the verify above returns empty
-- ROLLBACK;   -- ← if anything is off
```

> After COMMIT, recompute spend/visits/metrics from the authoritative source (no double-count):
> trigger tRPC **`customers.enrich`** then **`customers.refreshMetrics`** from the admin UI
> (or call `enrichCustomerData()` + `refreshCustomerMetrics()` once). §3 note explains why.

---

## 6. (d) Backup + rollback — **DO THIS FIRST**

### 6a. Snapshot the affected rows into timestamped backup tables (run BEFORE §5)
```sql
-- Full snapshot of every customer in a dupe cluster (losers AND survivors)
CREATE TABLE _bak_customers_20260603 AS
SELECT c.* FROM customers c
WHERE RIGHT(REGEXP_REPLACE(c.phone,'[^0-9]',''),10) IN (
  SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)
  FROM customers
  WHERE CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
  GROUP BY 1 HAVING COUNT(*) > 1
);

-- Snapshot the child rows that will be repointed (so we can restore exact prior FK values)
CREATE TABLE _bak_invoices_20260603          AS SELECT id, customerId          FROM invoices          WHERE customerId          IN (SELECT id FROM _bak_customers_20260603);
CREATE TABLE _bak_tire_orders_20260603       AS SELECT id, customerId          FROM tire_orders       WHERE customerId          IN (SELECT id FROM _bak_customers_20260603);
CREATE TABLE _bak_portal_sessions_20260603   AS SELECT id, customerId          FROM portal_sessions   WHERE customerId          IN (SELECT id FROM _bak_customers_20260603);
CREATE TABLE _bak_winback_sends_20260603     AS SELECT id, customerId          FROM winback_sends     WHERE customerId          IN (SELECT id FROM _bak_customers_20260603);
CREATE TABLE _bak_sms_campaign_sends_20260603 AS SELECT id, customerId         FROM sms_campaign_sends WHERE customerId          IN (SELECT id FROM _bak_customers_20260603);
CREATE TABLE _bak_communication_log_20260603 AS SELECT id, customer_id         FROM communication_log WHERE customer_id         IN (SELECT id FROM _bak_customers_20260603);
CREATE TABLE _bak_payments_20260603          AS SELECT id, customer_id         FROM payments          WHERE customer_id         IN (SELECT id FROM _bak_customers_20260603);
CREATE TABLE _bak_customer_metrics_20260603  AS SELECT *                        FROM customer_metrics  WHERE customerId          IN (SELECT id FROM _bak_customers_20260603);
```

### 6b. Rollback procedure
1. **If still inside the §5 transaction:** `ROLLBACK;` — done, nothing changed.
2. **If already COMMITted** — restore from the snapshots:
   ```sql
   -- Re-insert any deleted loser customer rows (id is preserved in the backup)
   INSERT INTO customers SELECT * FROM _bak_customers_20260603
   ON DUPLICATE KEY UPDATE id = id;   -- survivors already exist; this re-adds only the deleted losers
   -- ^ NOTE: the new normalized unique key (§7) may reject re-inserting losers whose phone10 collides.
   --   If §7's index is already applied, DROP it first, restore, re-dedup, re-add. Sequence matters —
   --   restore BEFORE applying §7, or be ready to drop §7's index to restore.

   -- Restore child FKs to their exact prior values
   UPDATE invoices          t JOIN _bak_invoices_20260603          b ON t.id = b.id SET t.customerId  = b.customerId;
   UPDATE tire_orders       t JOIN _bak_tire_orders_20260603       b ON t.id = b.id SET t.customerId  = b.customerId;
   UPDATE portal_sessions   t JOIN _bak_portal_sessions_20260603   b ON t.id = b.id SET t.customerId  = b.customerId;
   UPDATE winback_sends     t JOIN _bak_winback_sends_20260603     b ON t.id = b.id SET t.customerId  = b.customerId;
   UPDATE sms_campaign_sends t JOIN _bak_sms_campaign_sends_20260603 b ON t.id = b.id SET t.customerId = b.customerId;
   UPDATE communication_log t JOIN _bak_communication_log_20260603 b ON t.id = b.id SET t.customer_id = b.customer_id;
   UPDATE payments          t JOIN _bak_payments_20260603          b ON t.id = b.id SET t.customer_id = b.customer_id;

   -- Restore metrics rows
   DELETE FROM customer_metrics WHERE customerId IN (SELECT id FROM _bak_customers_20260603);
   INSERT INTO customer_metrics SELECT * FROM _bak_customer_metrics_20260603;
   ```
3. Drop the backup tables only after the operator confirms the merge is good for a few days:
   `DROP TABLE _bak_customers_20260603, _bak_invoices_20260603, …;`

> **Strong recommendation:** in addition to the in-DB snapshot tables, take a **provider-level backup**
> first (TiDB Cloud snapshot / mysqldump of `customers` + the 8 child tables). The snapshot tables cover
> the row-level rollback; a full export is the seatbelt if a query is wrong in a way the snapshots don't capture.

---

## 7. The durable fix — normalized unique key (PROPOSAL migration, hand-applied)

The raw-string unique key is the bug. Replace it with a key on a **stored, normalized** phone so two
formats of the same number can never both exist. Two safe options — recommend **Option A** (generated column):

### Option A — generated column + unique index (cleanest; MySQL 5.7+/TiDB support stored generated cols)
```sql
-- drizzle/00NN_customer_phone_normalized_unique.sql  (HAND-APPLY after §5 dedup completes)
-- PHASE 1 of this file is the §5 merge (must run + COMMIT first, else the ALTER fails on dupes).

ALTER TABLE `customers`
  ADD COLUMN `phone_normalized` VARCHAR(10)
  GENERATED ALWAYS AS (RIGHT(REGEXP_REPLACE(`phone`,'[^0-9]',''),10)) STORED;
--> statement-breakpoint
ALTER TABLE `customers` DROP INDEX `uniq_customer_phone`;
--> statement-breakpoint
ALTER TABLE `customers` ADD UNIQUE KEY `uniq_customer_phone_norm` (`phone_normalized`);
```
With this, an insert of `+12165551234` and an insert of `2165551234` both generate `phone_normalized =
'2165551234'` → the second fails `ER_DUP_ENTRY` → the existing race-safe catch blocks
(`shopdriver.ts:497`, `shopDriverMirror.ts:750`, `customerLookup.ts:89`) convert it to an UPDATE.
**No application change is strictly required** because every insert site already catches Duplicate-entry.
(Schema note: add `phoneNormalized: varchar(...).generatedAlwaysAs(...)` to `drizzle/schema.ts` so
drizzle-kit stays in sync — but the constraint is enforced by the hand-applied SQL above, per nickstire's
no-auto-migrate rule.)

### Option B — normalize-on-write + keep the key on `phone`
If generated columns are undesirable, store the normalized value directly in `phone` at every insert
(see §8) and keep `uniq_customer_phone` on `phone`. Simpler schema, but relies on **all** writers
normalizing — riskier (one missed site re-opens the bug). Option A enforces it in the DB regardless of code.

---

## 8. (e) Import-time GUARD — code change to PREVENT re-creation (DESCRIBED, not applied)

> Per the task: **described for review, NOT implemented.** This is what stops dupes from coming back.

**The one structural change (do this regardless of Option A/B):** make every customer insert store the
phone in **one canonical format (10-digit)**. Today only `customerLookup.findOrCreateCustomer` stores raw.

- **File:** `server/services/customerLookup.ts`
  - **`findOrCreateCustomer` (line 49-101):** before the `db.insert(customers).values({ … phone: data.phone … })`
    at **line 83-88**, normalize once: `const phone = data.phone.replace(/\D/g,"").replace(/^1(\d{10})$/,"$1");`
    (i.e. reuse the exact `normalizePhone` logic from `shopDriverMirror.ts:639-644`) and insert `phone`
    instead of `data.phone`. The lookup at **line 30** already strips to last-10, so find + insert finally
    agree on the canonical key. **This single edit closes the dominant dupe factory** (§1b).
- **Standardize the helper:** extract the `shopDriverMirror.ts` `normalizePhone` (lines 639-644) into a
  shared util (e.g. `server/lib/phone.ts` `normalizePhone10()`), and have **all five** insert sites use it:
  `shopdriver.ts:446` & `:707` (already normalize — just point at the shared fn), `nick/intelligence.ts:675`
  (currently `replace(/\D/g,"")` only — does NOT strip a leading country-`1`, so an 11-digit import row would
  diverge from a 10-digit one → switch to the shared fn), `shopDriverMirror.ts` (already), and
  `customerLookup.ts:86` (the fix above). kaizen: one helper, one format, no drift.
- **Belt-and-suspenders:** Option A's generated-column unique key (§7) makes the DB reject any un-normalized
  dupe even if a future insert site forgets to normalize. Code normalizes for clean stored values; the DB
  guarantees uniqueness. Apply **both**.

**Do NOT** change `customers.phone` length or the phone-keyed child tables — they already match by last-10
and will keep working once the stored value is canonical.

---

## 9. Recommended execution order (for the operator, when approved)

1. Run **§2** sizing queries; confirm scope and eyeball the dupe groups + the name+vehicle cross-check.
2. Take a **provider-level backup** (TiDB snapshot / dump) + run **§6a** snapshot tables.
3. Run **§5** Steps A–E inside the transaction; run the final verify; **COMMIT** only if it returns 0 dupes.
4. Trigger **`customers.enrich`** then **`customers.refreshMetrics`** (recompute spend/visits/metrics — no double-count).
5. Apply **§7 Option A** migration (hand-applied SQL) so re-creation is impossible.
6. Land the **§8** code guard (separate reviewed PR) so stored values stay canonical.
7. Confirm on the customers page: "Total Customers" drops to the de-duped count; no name-case twins remain.
8. After a few days of confidence, `DROP` the `_bak_*` tables.

---

## Appendix — files & lines cited
- `drizzle/schema.ts` — `customers` :949-1010 (unique key :1004); FK children §4a (:1052/:1151/:1195/:1411/:1486/:1681/:1759/:1813); separate spaces §4b (:1880/:1907/:2061/:2446/:2499/:2652/:2678; users-space :307/:330/:595).
- `drizzle/0034_wave116_customer_phone_unique.sql` — prior dedup (by exact phone) + the raw-string unique key (:62).
- `server/services/customerLookup.ts` — raw-phone insert :83-88; last-10 lookup :30 (the dominant dupe factory).
- `server/services/shopDriverMirror.ts` — `normalizePhone` :639-644; upsert path :659-771.
- `server/routers/shopdriver.ts` — CSV import :446; API sync :707; race-safe catch :497/:750.
- `server/routers/nick/intelligence.ts` — bulk import :675 (digits-only, no country-1 strip).
- `server/services/dataPipelines.ts` — `enrichCustomerData` (idempotent SET by phone10) :344-486.
- `server/services/customerMetricsRefresh.ts` — metrics rebuild :28-98 (creates missing rows :39-44).
- `server/routers/customers.ts` — `vipCount` :207; `enrich` :431; `refreshMetrics` :871.
- `server/routers/nick/actions.ts` — proves `work_orders.customerId` is a ShopDriver/phone/WALK-IN string :149-150.
