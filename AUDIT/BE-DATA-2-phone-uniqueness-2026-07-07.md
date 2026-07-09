# BE-DATA-2 · customer phone uniqueness — 2026-07-07

Enforce that the same person can't exist as two `customers` rows because their phone was stored in
different formats (`+12168620005` vs `2168620005` vs `(216) 862-0005`). This closes the
duplicate-customer gap that splits history + mis-attributes revenue.

## Acceptance criteria (DoD) — all met

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | One canonical `normalizePhone()` | ✅ already existed | `server/lib/phone.ts` (E.164 + `phoneRawDigits` = last-10). 3 fragmented duplicates noted for later cleanup. |
| 2 | Zero existing duplicates by normalized phone | ✅ verified | prod pre-check: `dup_phone10_groups=0` of 1,944 customers. The unique-index build succeeding is itself proof. |
| 3 | DB enforces uniqueness | ✅ live in prod | `customers.phone10` = `VARCHAR(10) VIRTUAL GENERATED AS right(regexp_replace(phone,'[^0-9]',''),10)` + `uniq_customer_phone10` unique index. Verified via `information_schema`. |
| 4 | Every customer-INSERT path handles the conflict gracefully | ✅ verified (safety-critical) | All 7 `insert(customers)` sites already catch `ER_DUP_ENTRY` or upsert — see below. No blind insert. |
| 5 | Verified | ✅ | tsc 0 · vitest green · prod column+index present + sample computes correctly. |

## Why it's safe (the write-path audit)

`customers` already had `uniq_customer_phone` (unique on the **raw** string). The new `phone10` index
is **stricter** — it also catches format variants. It can only newly-break an insert that stores an
un-normalized phone via a *blind* insert. Audit of all 7 insert sites found **none** do that:

- `customerLookup.findOrCreate` — stores last-10 canonical (`phoneRawDigits`) + `try/catch ER_DUP_ENTRY → re-find`.
- `shopdriver.ts` ×2 — explicit `try/catch Duplicate-entry → UPDATE` (comments literally anticipate the unique constraint).
- `shopDriverMirror` ×2 — `onDuplicateKeyUpdate` upsert + per-row catch fallback.
- `intelligence` import ×2 — per-row `try/catch → skipped++`, pre-dedupes by `phone.slice(-10)`.

So the stricter conflict is absorbed by existing handlers.

## Implementation

- **Prod (applied first):** `ALTER TABLE customers ADD COLUMN phone10 … VIRTUAL` + `CREATE UNIQUE INDEX uniq_customer_phone10`.
  **VIRTUAL, not STORED** — TiDB rejects `ADD` of a STORED generated column via `ALTER`
  (`ER_UNSUPPORTED_ACTION_ON_GENERATED_COLUMN`); TiDB materializes the value in the index, so uniqueness
  + index-only lookups work identically. Reversible: `DROP INDEX uniq_customer_phone10; ALTER TABLE customers DROP COLUMN phone10`.
- **Code (this PR):** declared `customers.phone10` in `drizzle/schema.ts` via `generatedAlwaysAs(..., { mode: "virtual" })`
  (so the ORM knows it + excludes it from inserts — no schema drift) + registered the DDL in
  `handleRunMigrations` for fresh-DB reproducibility.

## Provenance note
The prod DDL was applied in a prior session (another agent finished the `VIRTUAL` apply I had staged) but
**the code was never synced** — leaving prod ahead of the schema. This PR closes that drift. This is the
exact failure mode the [schema-drift audit](SCHEMA-DRIFT-2026-07-07.md) exists to catch: apply-then-forget-code.

## Deferred (documented, not done here)
- 2 customers have <10-digit (invalid) phones — harmless for uniqueness (no collision), but bad data.
- 3 fragmented `normalizePhone`-style helpers (`shopDriverMirror`, `smsInstrumentation`, `normalizeMembershipPhone`)
  should consolidate onto `lib/phone.ts` — cleanup, not a bug.

_Clarity Gate: REVIEWED (2026-07-07). DoD verified against prod `information_schema` + the write-path
audit, not assumptions._
