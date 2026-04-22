# Schema Migration Plan — Deferred Risky Items

Status: **DESIGN + SAFETY PLAN, IMPL DEFERRED** (2026-04-22).
Blocker: each migration rewrites existing column data. One bad row,
one unhandled edge case, you corrupt production data with no easy
recovery. These need a dedicated sprint with staging + backups.

---

## 1. `bookings.preferredDate` varchar(30) → date

### The problem

Column is `varchar(30)`. Most modern rows contain ISO dates (`"2026-05-01"`)
because `server/routers/booking.ts:186` validates that format at insert.
But **legacy rows** may contain free text like `"next week"`, `"anytime"`,
`"Flexible"`, `""`, or `"TBD"`.

### Why we didn't migrate in the mega-wave

A naïve `ALTER TABLE bookings MODIFY COLUMN preferredDate DATE` would:
- Fail on any row where CAST to DATE fails
- OR silently set those rows to `'0000-00-00'` (depends on MySQL
  sql_mode — TiDB default is lax)

Either way, the data is corrupted before any read sees it.

### Safe migration (3-phase)

**Phase 1 — data audit (read-only, no downtime):**
```sql
-- Count bad rows
SELECT COUNT(*)
FROM bookings
WHERE preferredDate IS NOT NULL
  AND preferredDate != ''
  AND STR_TO_DATE(preferredDate, '%Y-%m-%d') IS NULL;

-- Sample the bad rows
SELECT id, preferredDate, message
FROM bookings
WHERE preferredDate IS NOT NULL
  AND preferredDate != ''
  AND STR_TO_DATE(preferredDate, '%Y-%m-%d') IS NULL
LIMIT 50;
```

**Phase 2 — backfill (write, reversible):**
```sql
-- Move bad text into adminNotes for recovery
UPDATE bookings
SET adminNotes = CONCAT(
      COALESCE(adminNotes, ''),
      '\n[migrated-preferredDate-text: ',
      COALESCE(preferredDate, 'NULL'),
      ']'
    ),
    preferredDate = NULL
WHERE preferredDate IS NOT NULL
  AND preferredDate != ''
  AND STR_TO_DATE(preferredDate, '%Y-%m-%d') IS NULL;
```

Ship Phase 2, leave in production for 48h, spot-check that nothing
broke (admin displays, cron jobs that filter on preferredDate).

**Phase 3 — type change (atomic, irreversible):**
```sql
ALTER TABLE bookings
  MODIFY COLUMN preferredDate DATE NULL;
```

Update `drizzle/schema.ts` to match:
```ts
preferredDate: date("preferredDate"),
```

Also update the zod input schema in `routers/booking.ts` — it already
validates YYYY-MM-DD, so no Code change needed on the zod layer.

### Rollback plan

If Phase 3 explodes:
```sql
ALTER TABLE bookings
  MODIFY COLUMN preferredDate VARCHAR(30) NULL;
```
Data already lost in Phase 2 backfill stays in adminNotes — recoverable.

### Downtime impact

Phase 3 ALTER on a 50k-row table is ~30–60 seconds on TiDB. Plan for
a quiet window.

---

## 2. `bookings.photoUrls` text → json

### The problem

Currently `text("photoUrls")`, stores `JSON.stringify([urls])` on write
and `JSON.parse` on read. The migration to `JSON` column type:
- Gives native index support
- Enables JSON functions (`->>`, `JSON_LENGTH`)
- Validates structure at insert time

### Safe migration

**Phase 1 — data audit:**
```sql
-- Find rows where the text is not valid JSON
SELECT id, photoUrls
FROM bookings
WHERE photoUrls IS NOT NULL
  AND photoUrls != ''
  AND JSON_VALID(photoUrls) = 0
LIMIT 50;
```

Expected: 0 rows (all inserts went through `JSON.stringify()`). But
verify before trusting.

**Phase 2 — backfill (if needed):**
```sql
UPDATE bookings
SET photoUrls = NULL
WHERE photoUrls IS NOT NULL
  AND photoUrls != ''
  AND JSON_VALID(photoUrls) = 0;
```

**Phase 3 — type change:**
```sql
ALTER TABLE bookings
  MODIFY COLUMN photoUrls JSON NULL;
```

Update `drizzle/schema.ts`:
```ts
photoUrls: json("photoUrls").$type<string[]>(),
```

Update `booking.create` code in `routers/booking.ts:266`:
```ts
// Before
photoUrls: input.photoUrls?.length ? JSON.stringify(input.photoUrls) : null,
// After
photoUrls: input.photoUrls?.length ? input.photoUrls : null,
```

Update any read-side JSON.parse calls — grep for `JSON.parse.*photoUrls`.

---

## 3. Missing timestamps audit

**Known tables missing at least one of createdAt / updatedAt:**
- `shop_settings` (has updatedAt, missing createdAt)
- `notification_messages` (check)
- `analytics_snapshots` (check)
- `mechanic_qa` (check)
- 4 more to audit

### Approach

Script: `scripts/audit-schema.mjs` that reads drizzle schema and flags
tables without `createdAt` + `updatedAt`. Run once:
```bash
node scripts/audit-schema.mjs
```

Then add in a single migration. MySQL's `DEFAULT CURRENT_TIMESTAMP`
and `ON UPDATE CURRENT_TIMESTAMP` are free — no code change needed
past schema.

---

## 4. Missing indexes audit

**Run in prod:**
```sql
SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, INDEX_NAME;
```

Cross-reference against the drizzle schema. Expected missing:
- `invoices(customerPhone)` — for customer lookup by phone
- `leads(source, createdAt)` — for source attribution reports
- `callback_requests(status, createdAt)` — for pending callbacks
- `service_history(customerId, completedAt)` — for journey tracking

Add as a single migration:
```sql
CREATE INDEX idx_invoices_customer_phone ON invoices(customerPhone);
CREATE INDEX idx_leads_source_created ON leads(source, createdAt);
-- etc
```

Zero risk, zero downtime, queries instantly faster.

---

## 5. Column naming — decide and document

**Current:** Table names snake_case (`customer_vehicles`), column names
camelCase (`customerId`, `createdAt`). Odd mix.

**Decision to make:** stick with the mix (cheap, zero work) or fully
normalize to snake_case columns (expensive, requires updating every
Drizzle schema definition AND migrating column names in prod).

**Recommendation:** Stick with the mix. Document that Drizzle TS uses
camelCase property names with snake_case column names via the
`dbColumnName("foo_bar")` form. Not beautiful, but zero production
risk and zero engineering time.

If someone insists on snake_case columns: budget 2 days + a full
regression pass.

---

## When to ship this

Prereqs:
1. **Staging environment exists.** Can't validate Phase 2 backfill in
   prod blind. Railway supports preview environments — set one up
   pointed at a TiDB staging DB.
2. **Full prod DB backup verified.** Not just "the backup ran" — an
   actual restore drill to a throwaway DB that proves the backup
   round-trips.
3. **Quiet window scheduled.** Sunday 2am ET, no bookings active.

With those three in hand, the whole migration chain (phases 1–3 for
each column + timestamp + index sprint) fits in a 2-hour window.

Without them, we're gambling on production data.

**Ship trigger:** "we have staging + a tested backup restore." Until
then, this doc is the mirror of what would happen when we do.
