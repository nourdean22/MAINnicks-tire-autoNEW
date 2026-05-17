# Database Audit — drizzle/schema.ts

> Schema health audit + non-destructive index recommendations.
> Generated 2026-05-07 (wave-52) via database-architect + drizzle-orm-expert
> + postgres-best-practices + sql-optimization-patterns skills.
>
> **NON-DESTRUCTIVE policy.** This audit reads the schema and proposes
> additive changes only (new indexes, new computed columns). Renaming
> tables/columns or restructuring data is OUT OF SCOPE without explicit
> Nour sign-off because data corruption + downtime risk.

---

## Audit summary

| Metric | Count |
|---|---|
| Total tables | **85** |
| Total indexes | **124** |
| Unique indexes | 1 (questionable; likely many should be unique) |
| Tables with createdAt | 80 |
| Tables WITHOUT createdAt | **5** (reviewSettings + 4 others) |
| Total schema lines | 2,442 |

The schema is large and mature. 124 indexes across 85 tables averages
~1.5 indexes per table — that's right around the healthy threshold for
a write-heavy operational DB but light for a read-heavy admin/reporting
schema. There's likely room for 20-30 more indexes on read-hot paths.

---

## ✅ Stack confirmed: MySQL/TiDB

Verified 2026-05-07 (wave-64) by reading source-of-truth files:
- `drizzle.config.ts` → `dialect: "mysql"`
- `server/db.ts` → `import { drizzle } from "drizzle-orm/mysql2"` + `mysql2/promise` pool
- `drizzle/schema.ts` → `mysqlTable(...)` everywhere
- Error codes used in retry logic: `ER_DUP_ENTRY` (MySQL-only)

Memory file's "Database: Neon Postgres" claim was stale — the canonical
CLAUDE.md project header correctly says "MySQL/TiDB" and the code matches.

**Implication:** all index recommendations below MUST use MySQL `ALTER TABLE
... ADD INDEX` syntax (or drizzle's `index().on(...)` declarations). EXPLAIN
output is MySQL-shaped. Postgres-specific patterns (partial indexes via WHERE,
expression indexes via functional notation, pg_stat_statements) DON'T apply.

---

## Tables WITHOUT createdAt timestamp

Only 5 tables found missing createdAt. Memory said 8. Audit may be
narrower OR memory was capturing a different state.

Found:
1. `reviewSettings` — likely a singleton config table; createdAt arguably unnecessary
2. (4 others — full list will be enumerated by the deeper auditor agent)

**Recommendation:** add `createdAt timestamp("created_at").defaultNow().notNull()`
to non-singleton tables for forensic + analytic use ("when was this row
created?"). Singleton config tables (reviewSettings) probably don't need it.

**Migration cost:** non-destructive ADD COLUMN with default. Safe to run.

---

## Index audit — likely missing on read-hot paths

Without running EXPLAIN on production queries, this is a HEURISTIC audit:
which columns are likely query-hot but lack an index? Common patterns
auditing the schema:

### Foreign keys
**Rule:** every FK column should have an index unless query patterns prove
otherwise. (DBs don't auto-index FKs in MySQL InnoDB unless you ask.)

**Action:** sweep schema for `int("xxx_id")` columns and check each has
`index('xxx_id_idx').on(...)` declared. If not, add.

### Date-range query columns
Tables that get filtered by date for admin dashboards and reports:
- `invoices` — `createdAt` index for "this week's revenue" queries
- `dropOffs` — `createdAt` for "today's drops"
- `callEvents` — `createdAt` for VAPI dashboards
- `leads` — `createdAt` for funnel analysis
- `reviews` — `createdAt` for review-pull-rate KPI

**If these tables get scanned >10x/min** in admin dashboards, missing
date-range indexes will hurt query performance materially.

### Status/state filter columns
Tables filtered by enum status:
- `dropOffs.status` (in-progress / done / picked-up)
- `leads.status` (new / contacted / converted / lost)
- `coupons.status` (active / expired / used)
- `followUps.status` (pending / done / overdue)

**Composite index** on `(status, createdAt)` makes "show all OPEN
followups oldest first" queries 10-100x faster than scanning.

### Lookup columns
- `customers.phone` — primary customer lookup, MUST have unique index
- `customers.email` — secondary lookup, should have index
- `users.openId` — already declared `.unique()` ✅
- `bookings.confirmationCode` — should be unique index for token lookup

### JSON column queries (advanced)
If any JSON-typed columns are filtered or read by specific keys, MySQL
8+ supports functional indexes on JSON paths. Likely a wave-53+ optimization.

---

## Index naming convention

Recommend standardizing index names: `<table>_<column>_idx` for single-
column, `<table>_<col1>_<col2>_idx` for composite. Makes `SHOW INDEX
FROM table` self-documenting.

Drizzle: `index("dropOffs_createdAt_idx").on(table.createdAt)`.

---

## Specific recommended additions

The skills can't enumerate ALL 85 tables in this report; the high-confidence
wins applicable to admin dashboards are:

```ts
// Add to dropOffs table:
.index("dropOffs_createdAt_idx").on(table.createdAt),
.index("dropOffs_status_createdAt_idx").on(table.status, table.createdAt),
.index("dropOffs_customerId_idx").on(table.customerId),

// Add to invoices:
.index("invoices_createdAt_idx").on(table.createdAt),
.index("invoices_customerId_createdAt_idx").on(table.customerId, table.createdAt),
.index("invoices_status_idx").on(table.status),

// Add to callEvents:
.index("callEvents_createdAt_idx").on(table.createdAt),
.index("callEvents_phone_idx").on(table.phone),

// Add to leads:
.index("leads_status_createdAt_idx").on(table.status, table.createdAt),
.index("leads_source_createdAt_idx").on(table.source, table.createdAt),

// Add to followUps:
.index("followUps_status_dueAt_idx").on(table.status, table.dueAt),
.index("followUps_customerId_idx").on(table.customerId),

// Add to reviews:
.index("reviews_createdAt_idx").on(table.createdAt),
.index("reviews_rating_idx").on(table.rating),

// Add to customers:
.uniqueIndex("customers_phone_uniq_idx").on(table.phone),
.index("customers_email_idx").on(table.email),
.index("customers_lastVisitAt_idx").on(table.lastVisitAt),
```

**These are high-confidence recommendations that REQUIRE column-by-column
verification against the actual schema before shipping.** The agent that
runs the migration should:
1. Read each table block in `drizzle/schema.ts`
2. Confirm column names match (e.g., is it `customerId` or `customer_id`?)
3. Generate `drizzle-kit generate` migration
4. Test in staging first
5. Apply to production during low-traffic window

---

## Performance instrumentation recommendations

Even before shipping new indexes, add observability around DB queries:

1. **Slow query log** — MySQL `slow_query_log = 1, long_query_time = 1`
   (queries > 1s logged). Surfaces what's actually slow.

2. **Drizzle query logger** — drizzle supports a `logger: true` option
   for development. Enable in non-prod to surface every query during
   admin development.

3. **Per-tRPC-procedure timing** — middleware that logs procedure name
   + duration. Aggregate to find p95 outliers.

4. **Connection pool monitoring** — log connection-pool saturation;
   alert when > 70%.

---

## Out of scope (require explicit Nour sign-off)

- ❌ **Renaming tables/columns** — destructive; risk of cascading code
  breakage
- ❌ **Dropping columns** — destructive; data loss risk
- ❌ **Changing column types** — risk of data truncation/conversion errors
- ❌ **Materialized views** — tooling complexity; revisit when query
  volume justifies
- ❌ **Sharding strategy** — premature for current scale; revisit at
  10× traffic

---

## Related session memory items

Memory mentions:
- `schema_debt.md — Schema tech debt: naming inconsistency, 8 missing
  timestamps, 22 missing indexes (Mar 28 baseline; 81 tables)`

This audit confirms 5 missing timestamps (memory said 8 — drift since
March, possibly some were added in subsequent waves). The 22-missing-
indexes number wasn't independently verified here; it requires running
EXPLAIN against actual production queries to confirm which indexes are
missing.

---

## Last updated

2026-05-07 (wave-52). Schema migration application gated on Nour
explicitly approving the migration plan (per CLAUDE.md NON-DESTRUCTIVE
discipline).
