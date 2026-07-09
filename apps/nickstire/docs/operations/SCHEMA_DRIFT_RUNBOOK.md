# Schema-Drift Audit Runbook

How to verify that prod TiDB, `drizzle/schema.ts`, and the `handleRunMigrations` bootstrap all
agree — and how to keep them agreeing. This method found **3 live bugs** in July 2026
([conversationMemory.conversionHits + pipeline_runs.error → PR #612](../../../../AUDIT/SCHEMA-DRIFT-2026-07-07.md),
review_pipeline phantom columns → PR #628). Last full run 2026-07-09: **zero drift**.

## Why drift is a live-bug generator (not a style issue)

Drizzle's full `d.select().from(table)` emits **every declared column by name** — not `SELECT *`.
A column that exists in the decl but not in prod throws `Unknown column` at runtime; a column
written by code but missing in prod throws on INSERT/UPDATE. Both classes shipped here.

**The two traps that actually happened:**

1. **Apply-then-forget-code** — prod DDL gets applied (sometimes by a different agent/session)
   but the drizzle decl + `handleRunMigrations` entry never land. Prod is then *ahead* of code.
   Rule: prod DDL and the code sync ship in the **same effort**, or it silently drifts.
2. **"Declared-but-not-written ≠ harmless"** — a phantom decl column that no code *writes* still
   breaks every full `select()` that *reads* the table. Always check the read side
   (`grep "select().from(theTable)"`) before calling a dead decl harmless.

## The audit procedure (~10 min, read-only against prod)

Run from `apps/nickstire/`. Temp scripts are prefixed `_` and **must be deleted before commit**.

### Step 1 — dump prod truth

Create `_verify_dump.cjs`:

```js
// READ-ONLY · dump prod columns + FK constraints. Writes _verify_dump.json.
const mysql = require("mysql2/promise");
const fs = require("fs");
(async () => {
  const url = process.env.DATABASE_URL || "";
  if (!url.startsWith("mysql://")) { console.error("ABORT"); process.exit(1); }
  let conn;
  try { conn = await mysql.createConnection(url); }
  catch { conn = await mysql.createConnection(url + (url.includes("?") ? "&" : "?") + "ssl={\"rejectUnauthorized\":true}"); }
  try {
    const [cols] = await conn.query(
      `SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE dt, COLUMN_TYPE ct, IS_NULLABLE nul
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`);
    const columns = {};
    for (const r of cols) (columns[r.t] ??= {})[r.c] = { dataType: r.dt, columnType: r.ct, nullable: r.nul === "YES" };
    const [fks] = await conn.query(
      `SELECT k.CONSTRAINT_NAME name, k.TABLE_NAME t, k.COLUMN_NAME c,
              k.REFERENCED_TABLE_NAME rt, k.REFERENCED_COLUMN_NAME rc, r.DELETE_RULE del
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON k.CONSTRAINT_NAME=r.CONSTRAINT_NAME AND k.CONSTRAINT_SCHEMA=r.CONSTRAINT_SCHEMA
       WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME`);
    fs.writeFileSync("_verify_dump.json", JSON.stringify({ columns, fks }));
    console.log(`WROTE _verify_dump.json · tables=${Object.keys(columns).length} fks=${fks.length}`);
  } finally { await conn.end(); }
})().catch((e) => { console.error("ERR", e.code || "", e.message); process.exit(1); });
```

Run it with prod credentials injected (never printed):

```
railway run --service MAINnicks-tire-auto -- node _verify_dump.cjs
```

### Step 2 — diff offline (no prod access)

Create `_verify_diff.cjs`:

```js
// OFFLINE · full prod<->code drift verification.
const fs = require("fs");
const dump = JSON.parse(fs.readFileSync("_verify_dump.json", "utf8"));
const schema = fs.readFileSync("drizzle/schema.ts", "utf8");
const migr = fs.readFileSync("server/routers/nick/intelligence.ts", "utf8");

// A. column type drift (drizzle decl vs prod)
const MAP = { int:["int"], bigint:["bigint"], smallint:["smallint"], tinyint:["tinyint"],
  varchar:["varchar"], char:["char"], text:["text"], mediumtext:["mediumtext"], longtext:["longtext"],
  mysqlEnum:["enum"], boolean:["tinyint"], timestamp:["timestamp","datetime"], datetime:["datetime","timestamp"],
  date:["date"], json:["json"], decimal:["decimal"], double:["double"], float:["float"], real:["double"] };
const colRe = new RegExp(`^\\s*\\w+:\\s*(${Object.keys(MAP).join("|")})\\(\\s*"([^"]+)"`);
let table = null; const drifts = []; const missing = [];
for (const line of schema.split("\n")) {
  const tm = line.match(/mysqlTable\(\s*"([^"]+)"/); if (tm) { table = tm[1]; continue; }
  if (!table) continue;
  const cm = line.match(colRe); if (!cm) continue;
  const [, helper, dbcol] = cm;
  const pc = dump.columns[table] && dump.columns[table][dbcol];
  if (!pc) { missing.push(`${table}.${dbcol} (drizzle ${helper}) not in DB`); continue; }
  if (!MAP[helper].includes(pc.dataType)) drifts.push(`${table}.${dbcol}: drizzle ${helper} vs DB ${pc.dataType}`);
}
// B. every prod FK reproducible in handleRunMigrations
const fkNotRegistered = dump.fks.filter((f) => !migr.includes(f.name)).map((f) => f.name);
// C. onDelete sanity: money/ledger tables must NOT be CASCADE
const MONEY = ["payments","invoices","loyalty_transactions"];
const badCascade = dump.fks.filter((f) => MONEY.includes(f.t) && f.del === "CASCADE").map((f) => `${f.name} (${f.t} CASCADE!)`);

console.log("A · TYPE DRIFTS (" + drifts.length + ")"); drifts.forEach((d) => console.log("  " + d));
console.log("A · DECLARED, NOT IN DB (" + missing.length + ")"); missing.forEach((m) => console.log("  " + m));
console.log("B · PROD FKs (" + dump.fks.length + ") NOT in handleRunMigrations (" + fkNotRegistered.length + ")");
fkNotRegistered.forEach((f) => console.log("  " + f));
console.log("C · money-table CASCADE (" + badCascade.length + ")"); badCascade.forEach((f) => console.log("  " + f));
const clean = !drifts.length && !missing.length && !fkNotRegistered.length && !badCascade.length;
console.log("\nVERDICT=" + (clean ? "PERFECT — prod and code fully agree" : "ISSUES FOUND"));
```

```
node _verify_diff.cjs
```

Note the diff is line-regex based: it catches single-line `helper("dbcol")` decls (the schema's
dominant style) and misses multi-line or computed decls — treat `VERDICT=PERFECT` as "no drift in
scannable decls", and eyeball anything exotic. It also doesn't detect prod columns absent from
drizzle (the review_pipeline `keywordsJson`/`urgency`/`status` direction) — when section A flags a
table, compare its full prod column list (`dump.columns[table]`) against the decl by hand.

### Step 3 — triage every finding by CALLERS, not by type name

For each drift, grep who touches the column before deciding:

| Finding class | Live-bug test | Fix direction |
|---|---|---|
| Declared, absent in prod | Any full `select()` or code WRITE on the table? → **live bug** | Whichever side matches intent — usually make decl equal prod |
| In prod, missing from decl | Harmless until someone needs it; still fix | Add to decl (match prod type exactly) |
| Type mismatch, both JS `number` (int/tinyint) | Cosmetic | Align decl to prod |
| Type mismatch changing the JS value (`date`, `json`, `timestamp`) | Check every read/write site; `mode: "string"` usually preserves behavior for date | Align only with per-caller evidence |

### Step 4 — clean up

```
rm _verify_dump.cjs _verify_diff.cjs _verify_dump.json
```

## Prod DDL rules (when a fix needs an ALTER)

- Apply via `railway run --service MAINnicks-tire-auto -- node <script.cjs>` — injects
  `DATABASE_URL` without printing it. Scripts: dry-run by default, re-verify preconditions
  immediately before the ALTER, idempotent, and note the reverse statement.
- **Same-effort rule:** the drizzle decl + `handleRunMigrations` entry commit together with (or
  immediately after) the prod apply. This is the whole game.
- **TiDB gotchas:** no `ALTER ... ADD COLUMN ... GENERATED ... STORED`
  (`ER_UNSUPPORTED_ACTION_ON_GENERATED_COLUMN`) — use `VIRTUAL`; indexes on virtual generated
  columns materialize the value, so unique enforcement works identically. FK child column type
  must exactly match the parent PK type (`ER_FK_INCOMPATIBLE_COLUMNS`).
- Data mutations (UPDATE/DELETE to fix orphans) need explicit operator confirmation — never bundle
  them silently into a DDL script.

## Current verified state (as of 2026-07-09, post-#628)

- 39 FK constraints live in prod, all named + reproducible in `handleRunMigrations`
  (ON DELETE: 19 SET NULL / 16 CASCADE / 4 RESTRICT; zero CASCADE on money tables).
  Candidate long tail: [AUDIT/FK-ROADMAP-2026-07-07.md](../../../../AUDIT/FK-ROADMAP-2026-07-07.md).
- `customers.phone10` VIRTUAL generated column + `uniq_customer_phone10` enforce phone-format
  dedupe ([AUDIT/BE-DATA-2](../../../../AUDIT/BE-DATA-2-phone-uniqueness-2026-07-07.md)).
- Column-level drift: **zero** ([AUDIT/SCHEMA-DRIFT-2026-07-07.md](../../../../AUDIT/SCHEMA-DRIFT-2026-07-07.md)
  has the per-item history).

Re-run this audit after any hand-applied prod DDL, after any agent-handoff session that touched
the DB, or quarterly.
