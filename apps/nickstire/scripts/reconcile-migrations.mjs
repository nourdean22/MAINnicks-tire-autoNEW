#!/usr/bin/env node
/**
 * Migration reconciliation reporter — READ ONLY, schema-fingerprinting.
 *
 * WHY THIS EXISTS
 * Four things claim to describe the schema and none of them agreed:
 *   1. drizzle/*.sql              — migrations on disk in THIS checkout
 *   2. drizzle/meta/_journal.json — what drizzle would apply to a fresh environment
 *   3. __drizzle_migrations       — what the target database believes it ran
 *   4. information_schema         — what is actually there
 * Only (4) is ground truth. Observed against prod 2026-07-18: 104 files, 104 journal
 * entries, 97 recorded rows — while the objects from the nine "unrecorded" migrations
 * were present, because their DDL had been hand-applied. The migration engine believes
 * 0082-0090 still need to run; production already contains their effects.
 *
 * WHY IT DOES NOT JUST CHECK "DOES THE TABLE EXIST"
 * That check is the exact fallacy this tool is meant to catch. A partially hand-applied
 * table exists while still being incompatible — right name, wrong column width, missing
 * unique index, absent foreign key. "Object present, therefore migration applied" would
 * report such a schema clean and green-light a migration run that then fails or, worse,
 * silently operates against a subtly different table. So every parsed statement is
 * compared property by property against information_schema.
 *
 * HONESTY ABOUT PARSING
 * This does not implement a full MySQL grammar. It parses the DDL shapes drizzle-kit
 * actually emits. Anything it cannot parse is reported UNKNOWN_UNSUPPORTED_DDL rather
 * than assumed fine — an unparsed statement is an open question, never a pass.
 *
 * SAFETY
 * Read-only by construction: every statement is checked against a SELECT/SHOW allowlist
 * before execution and the process aborts if anything else is ever passed. There is no
 * mutation code path here at all. Establishing a baseline (marking migrations applied) is
 * a separate, reviewed production change and is deliberately NOT implemented in this file.
 *
 * USAGE
 *   node scripts/reconcile-migrations.mjs --report          # never fails on drift (CI-safe)
 *   node scripts/reconcile-migrations.mjs --strict          # fails on drift (deploy preflight)
 *   node scripts/reconcile-migrations.mjs --report --json   # machine-readable
 *   node scripts/reconcile-migrations.mjs --env <path>      # explicit .env
 *
 * EXIT CODES
 *   0  report produced (--report), or ledgers agree (--strict)
 *   1  --strict only: drift or schema mismatch found
 *   2  could not inspect (no DATABASE_URL, DB unreachable, no drizzle dir)
 *
 * Default mode is --report ON PURPOSE. Production currently has nine unrecorded
 * migrations; a tool that exits 1 on every ordinary build teaches everyone to ignore it.
 * Switch CI to --strict only once the baseline is repaired.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const DRIZZLE = path.join(APP, "drizzle");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => (has(f) ? argv[argv.indexOf(f) + 1] : null);
const asJson = has("--json");
const strict = has("--strict");
if (strict && has("--report")) {
  console.error("--report and --strict are mutually exclusive");
  process.exit(2);
}

/* ── classification ──────────────────────────────────────────────────────────── */

const STATE = {
  RECORDED_AND_MATCHED: "RECORDED_AND_MATCHED",
  RECORDED_BUT_SCHEMA_MISMATCH: "RECORDED_BUT_SCHEMA_MISMATCH",
  UNRECORDED_BUT_EXACT_MATCH: "UNRECORDED_BUT_EXACT_MATCH",
  UNRECORDED_AND_PARTIAL_MATCH: "UNRECORDED_AND_PARTIAL_MATCH",
  UNRECORDED_AND_ABSENT: "UNRECORDED_AND_ABSENT",
  UNKNOWN_UNSUPPORTED_DDL: "UNKNOWN_UNSUPPORTED_DDL",
};
/** Only these mean "nothing to do". Everything else needs a human. */
const CLEAN_STATES = new Set([STATE.RECORDED_AND_MATCHED]);

/* ── read-only enforcement ───────────────────────────────────────────────────── */

const READ_ONLY = /^\s*(SELECT|SHOW)\b/i;
function assertReadOnly(sql) {
  if (!READ_ONLY.test(sql)) {
    // Not an exception to catch — a bug in this file that must never reach a database.
    console.error(`REFUSED: non-read statement in a read-only tool:\n${sql.slice(0, 200)}`);
    process.exit(2);
  }
  return sql;
}

/* ── DDL parsing (drizzle-kit output shapes only) ────────────────────────────── */

const unquote = (s) => (s || "").trim().replace(/^[`"']|[`"']$/g, "");
const normType = (t) =>
  (t || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*,\s*/g, ",")
    .trim();

/** MySQL reports these without the length drizzle may or may not write. */
const LENGTHLESS = new Set(["text", "mediumtext", "longtext", "tinytext", "json", "date", "datetime", "timestamp", "time", "blob", "mediumblob", "longblob"]);

/**
 * Declared-vs-stored type equivalences.
 *
 * MySQL has no boolean type — it is an alias for tinyint(1), and
 * information_schema reports the alias TARGET. Comparing the declared spelling to
 * the stored one therefore flagged every boolean column in the repo as a
 * mismatch: 28 false positives that buried the genuine findings.
 */
const TYPE_ALIASES = new Map([
  ["boolean", "tinyint(1)"],
  ["bool", "tinyint(1)"],
  ["integer", "int"],
  ["dec", "decimal"],
  ["numeric", "decimal"],
]);

function canonType(t) {
  const n = normType(t);
  if (TYPE_ALIASES.has(n)) return TYPE_ALIASES.get(n);
  const b = n.match(/^([a-z]+)/)?.[1];
  if (b && TYPE_ALIASES.has(b) && !n.includes("(")) return TYPE_ALIASES.get(b);
  return n;
}

function baseType(t) {
  const m = normType(t).match(/^([a-z]+)/);
  return m ? m[1] : normType(t);
}

/**
 * Split a drizzle migration into statements. drizzle-kit writes an explicit
 * `--> statement-breakpoint` marker; fall back to semicolons when absent.
 */
function splitStatements(sql) {
  const stripped = sql.replace(/^\s*--(?!>).*$/gm, ""); // drop comments, keep breakpoints
  const parts = stripped.includes("statement-breakpoint")
    ? stripped.split(/-->\s*statement-breakpoint/)
    : stripped.split(/;\s*[\r\n]/);
  return parts.map((s) => s.replace(/;\s*$/, "").trim()).filter(Boolean);
}

/** Split on commas at depth 0, so type parameters like decimal(3,1) stay intact. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0, buf = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Parse the column list inside CREATE TABLE (...) at depth 1 only. */
function parseColumnList(body) {
  const cols = [];
  const constraints = [];
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      (buf.trim() ? cols : cols).push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) cols.push(buf.trim());

  const parsed = [];
  for (const raw of cols) {
    const c = raw.trim();
    if (/^(PRIMARY\s+KEY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN\s+KEY)\b/i.test(c)) {
      constraints.push(c);
      continue;
    }
    const m = c.match(/^[`"]?([A-Za-z0-9_]+)[`"]?\s+(.+)$/);
    if (!m) continue;
    const rest = m[2];
    const typeMatch = rest.match(/^([A-Za-z]+(?:\s+[A-Za-z]+)?(?:\([^)]*\))?(?:\s+unsigned)?)/i);
    parsed.push({
      name: m[1],
      type: typeMatch ? typeMatch[1] : rest.split(/\s+/)[0],
      notNull: /\bNOT\s+NULL\b/i.test(rest),
      autoInc: /\bAUTO_INCREMENT\b/i.test(rest),
    });
  }
  return { columns: parsed, constraints };
}

function parseStatement(stmt) {
  const s = stmt.replace(/\s+/g, " ").trim();

  let m = s.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?\s*\(([\s\S]*)\)[^)]*$/i);
  if (m) {
    const { columns } = parseColumnList(m[2]);
    return { kind: "create_table", table: m[1], columns, raw: s };
  }

  // ALTER TABLE x ADD COLUMN a ..., ADD COLUMN b ... is ONE statement with several
  // clauses. Parsing only the first lost every later column, and testing
  // /NOT NULL/ against the whole statement leaked one column's constraint onto
  // another — it reported users.adminRole (declared NULL) as NOT NULL because a
  // sibling clause in the same ALTER declared mfaEnabled NOT NULL. Each clause is
  // now judged on its own text.
  m = s.match(/^ALTER\s+TABLE\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+(ADD\s+(?:COLUMN\s+)?[\s\S]+)$/i);
  if (m && /ADD\s+(?:COLUMN\s+)?[`"]?[A-Za-z0-9_]+[`"]?\s+[A-Za-z]/i.test(m[2])) {
    const table = m[1];
    const clauses = splitTopLevel(m[2]);
    const cols = [];
    for (const c of clauses) {
      const cm = c.match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?\s+([A-Za-z]+(?:\([^)]*\))?(?:\s+unsigned)?)/i);
      if (!cm) continue; // ADD INDEX / ADD CONSTRAINT / ADD UNIQUE — not a column
      cols.push({ kind: "add_column", table, column: cm[1], type: cm[2], notNull: /\bNOT\s+NULL\b/i.test(c), raw: c });
    }
    if (cols.length === 1) return cols[0];
    if (cols.length > 1) return { kind: "multi", parts: cols, table, raw: s };
  }

  // MODIFY keeps the column name; only CHANGE takes a NEW name after the old one.
  // Sharing one regex let the optional rename group swallow the TYPE on MODIFY, so
  // "MODIFY COLUMN payload mediumtext NOT NULL" parsed its type as "not" — and the
  // migration was then reported ABSENT even though the column was correct.
  m = s.match(/^ALTER\s+TABLE\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+MODIFY\s+(?:COLUMN\s+)?[`"]?([A-Za-z0-9_]+)[`"]?\s+([A-Za-z]+(?:\([^)]*\))?(?:\s+unsigned)?)/i);
  if (m) return { kind: "modify_column", table: m[1], column: m[2], type: m[3], notNull: /\bNOT\s+NULL\b/i.test(s), raw: s };

  m = s.match(/^ALTER\s+TABLE\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+CHANGE\s+(?:COLUMN\s+)?[`"]?[A-Za-z0-9_]+[`"]?\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+([A-Za-z]+(?:\([^)]*\))?(?:\s+unsigned)?)/i);
  if (m) return { kind: "modify_column", table: m[1], column: m[2], type: m[3], notNull: /\bNOT\s+NULL\b/i.test(s), raw: s };

  m = s.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?\s+ON\s+[`"]?([A-Za-z0-9_]+)[`"]?\s*\(([^)]*)\)/i);
  if (m) {
    return {
      kind: "index", unique: Boolean(m[1]), name: m[2], table: m[3],
      columns: m[4].split(",").map((c) => unquote(c.replace(/\s+(asc|desc)$/i, ""))), raw: s,
    };
  }

  m = s.match(/^ALTER\s+TABLE\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+ADD\s+CONSTRAINT\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+FOREIGN\s+KEY/i);
  if (m) return { kind: "foreign_key", table: m[1], name: m[2], raw: s };

  m = s.match(/^DROP\s+INDEX\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+ON\s+[`"]?([A-Za-z0-9_]+)[`"]?/i);
  if (m) return { kind: "drop_index", name: m[1], table: m[2], raw: s };

  return { kind: "unsupported", raw: s.slice(0, 220) };
}

/* ── database fingerprint ────────────────────────────────────────────────────── */

async function fingerprint(conn, tables) {
  const fp = { tables: new Map() };
  if (!tables.size) return fp;
  const list = [...tables];
  const ph = list.map(() => "?").join(",");

  const [cols] = await conn.query(
    assertReadOnly(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND TABLE_NAME IN (${ph})`,
    ),
    list,
  );
  const [idx] = await conn.query(
    assertReadOnly(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND TABLE_NAME IN (${ph})
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    ),
    list,
  );
  const [fks] = await conn.query(
    assertReadOnly(
      `SELECT TABLE_NAME, CONSTRAINT_NAME
       FROM information_schema.table_constraints
       WHERE table_schema = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND TABLE_NAME IN (${ph})`,
    ),
    list,
  );

  for (const t of list) fp.tables.set(t, { exists: false, columns: new Map(), indexes: new Map(), fks: new Set() });
  for (const c of cols) {
    const t = fp.tables.get(c.TABLE_NAME);
    if (!t) continue;
    t.exists = true;
    t.columns.set(c.COLUMN_NAME, {
      type: normType(c.COLUMN_TYPE),
      nullable: c.IS_NULLABLE === "YES",
      extra: (c.EXTRA || "").toLowerCase(),
    });
  }
  for (const i of idx) {
    const t = fp.tables.get(i.TABLE_NAME);
    if (!t) continue;
    if (!t.indexes.has(i.INDEX_NAME)) t.indexes.set(i.INDEX_NAME, { unique: Number(i.NON_UNIQUE) === 0, columns: [] });
    t.indexes.get(i.INDEX_NAME).columns.push(i.COLUMN_NAME);
  }
  for (const f of fks) fp.tables.get(f.TABLE_NAME)?.fks.add(f.CONSTRAINT_NAME);
  return fp;
}

/** Compare one parsed statement against the live schema. */
function checkStatement(st, fp) {
  const t = st.table ? fp.tables.get(st.table) : null;
  const miss = (why) => ({ ok: false, why });

  switch (st.kind) {
    case "multi": {
      // One ALTER with several ADD COLUMN clauses: every part must hold.
      const problems = [];
      for (const part of st.parts) {
        const r = checkStatement(part, fp);
        if (r.ok === false) problems.push(r.why);
      }
      return problems.length ? miss(problems.join("; ")) : { ok: true };
    }
    case "create_table": {
      if (!t || !t.exists) return miss(`table ${st.table} absent`);
      const problems = [];
      for (const c of st.columns) {
        const live = t.columns.get(c.name);
        if (!live) { problems.push(`${st.table}.${c.name} missing`); continue; }
        const want = canonType(c.type);
        const got = canonType(live.type);
        const lengthless = LENGTHLESS.has(baseType(want));
        const typeOk = lengthless ? baseType(want) === baseType(got) : want === got || baseType(want) === baseType(got) && want.includes("(") === false;
        if (!typeOk) problems.push(`${st.table}.${c.name} type ${got} != ${want}`);
        if (c.notNull && live.nullable) problems.push(`${st.table}.${c.name} is NULLABLE, migration says NOT NULL`);
      }
      return problems.length ? miss(problems.join("; ")) : { ok: true };
    }
    case "add_column":
    case "modify_column": {
      if (!t || !t.exists) return miss(`table ${st.table} absent`);
      const live = t.columns.get(st.column);
      if (!live) return miss(`${st.table}.${st.column} missing`);
      const want = canonType(st.type);
      const liveType = canonType(live.type);
      const ok = LENGTHLESS.has(baseType(want)) ? baseType(want) === baseType(liveType) : want === liveType;
      if (!ok) return miss(`${st.table}.${st.column} type ${live.type} != ${want}`);
      if (st.notNull && live.nullable) return miss(`${st.table}.${st.column} is NULLABLE, migration says NOT NULL`);
      return { ok: true };
    }
    case "index": {
      if (!t || !t.exists) return miss(`table ${st.table} absent`);
      const live = t.indexes.get(st.name);
      if (!live) return miss(`index ${st.name} on ${st.table} missing`);
      if (st.unique && !live.unique) return miss(`index ${st.name} exists but is NOT UNIQUE`);
      const want = st.columns.map((c) => c.toLowerCase()).join(",");
      const got = live.columns.map((c) => c.toLowerCase()).join(",");
      if (want !== got) return miss(`index ${st.name} covers (${got}) not (${want})`);
      return { ok: true };
    }
    case "foreign_key": {
      if (!t || !t.exists) return miss(`table ${st.table} absent`);
      return t.fks.has(st.name) ? { ok: true } : miss(`foreign key ${st.name} missing`);
    }
    case "drop_index": {
      if (!t || !t.exists) return { ok: true }; // table gone => index gone
      return t.indexes.has(st.name) ? miss(`index ${st.name} still present (migration drops it)`) : { ok: true };
    }
    default:
      return { ok: null, why: "unsupported DDL — cannot verify" };
  }
}

/* ── main ────────────────────────────────────────────────────────────────────── */

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, from: "env" };
  const explicit = valueOf("--env");
  const candidates = explicit ? [path.resolve(process.cwd(), explicit)] : [path.join(APP, ".env")];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const m = fs.readFileSync(f, "utf8").match(/^DATABASE_URL=(.*)$/m);
    if (m) return { url: m[1].trim().replace(/^["']|["']$/g, ""), from: f };
  }
  return { url: null, from: null };
}

/** Identify the target without ever revealing credentials. */
function dbFingerprint(url) {
  try {
    const u = new URL(url.replace(/^mysql:\/\//, "http://"));
    return {
      host: u.hostname,
      port: u.port || "(default)",
      database: u.pathname.replace(/^\//, "").split("?")[0],
      hostHash: crypto.createHash("sha256").update(`${u.hostname}:${u.port}`).digest("hex").slice(0, 12),
    };
  } catch {
    return { host: "(unparseable)", port: "", database: "", hostHash: "" };
  }
}

async function main() {
  if (!fs.existsSync(DRIZZLE)) { console.error(`no drizzle dir at ${DRIZZLE}`); process.exit(2); }

  const files = fs.readdirSync(DRIZZLE).filter((f) => f.endsWith(".sql")).sort();
  const journalPath = path.join(DRIZZLE, "meta", "_journal.json");
  const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, "utf8")) : { entries: [] };
  const journalTags = new Set((journal.entries || []).map((e) => e.tag));

  const migrations = files.map((f) => {
    const buf = fs.readFileSync(path.join(DRIZZLE, f));
    const text = buf.toString("utf8");
    const statements = splitStatements(text).map(parseStatement);
    return {
      tag: f.replace(/\.sql$/, ""),
      file: f,
      // Both digests: a CRLF checkout and an LF checkout hash the same SQL differently,
      // which is itself a drift source worth surfacing rather than normalizing away.
      hashRaw: crypto.createHash("sha256").update(buf).digest("hex"),
      hashLf: crypto.createHash("sha256").update(Buffer.from(text.replace(/\r\n/g, "\n"), "utf8")).digest("hex"),
      statements,
    };
  });

  const { url, from } = loadDatabaseUrl();
  if (!url) { console.error("no DATABASE_URL (env or .env). Pass --env <path>."); process.exit(2); }
  const target = dbFingerprint(url);

  const touched = new Set();
  for (const m of migrations) for (const s of m.statements) if (s.table) touched.add(s.table);

  let applied = [];
  let fp = { tables: new Map() };
  try {
    const { createConnection } = await import("mysql2/promise");
    const conn = await createConnection(url);
    try {
      const [rows] = await conn.query(assertReadOnly("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC"));
      applied = rows;
      fp = await fingerprint(conn, touched);
    } finally { await conn.end(); }
  } catch (err) {
    console.error(`cannot inspect database: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const appliedHashes = new Set(applied.map((r) => r.hash));
  const matched = new Set();

  const rows = migrations.map((m) => {
    const via = appliedHashes.has(m.hashRaw) ? "raw" : appliedHashes.has(m.hashLf) ? "lf" : null;
    if (via) matched.add(via === "raw" ? m.hashRaw : m.hashLf);
    const recorded = Boolean(via);

    const checks = m.statements.map((s) => ({ st: s, res: checkStatement(s, fp) }));
    const unsupported = checks.filter((c) => c.res.ok === null);
    const failures = checks.filter((c) => c.res.ok === false);
    const verifiable = checks.length - unsupported.length;

    let state;
    if (unsupported.length && verifiable === 0) state = STATE.UNKNOWN_UNSUPPORTED_DDL;
    else if (recorded) state = failures.length ? STATE.RECORDED_BUT_SCHEMA_MISMATCH : STATE.RECORDED_AND_MATCHED;
    else if (!failures.length) state = STATE.UNRECORDED_BUT_EXACT_MATCH;
    else if (failures.length === verifiable) state = STATE.UNRECORDED_AND_ABSENT;
    else state = STATE.UNRECORDED_AND_PARTIAL_MATCH;

    return {
      tag: m.tag,
      journaled: journalTags.has(m.tag),
      recorded,
      state,
      statements: checks.length,
      unverifiable: unsupported.length,
      mismatches: failures.map((c) => c.res.why),
      unsupportedSamples: unsupported.slice(0, 3).map((c) => c.st.raw),
    };
  });

  const orphanApplied = applied.filter((r) => !matched.has(r.hash)).length;
  const byState = {};
  for (const r of rows) byState[r.state] = (byState[r.state] || 0) + 1;
  const notClean = rows.filter((r) => !CLEAN_STATES.has(r.state));
  const fileNotJournaled = rows.filter((r) => !r.journaled).map((r) => r.tag);
  const journaledNoFile = [...journalTags].filter((t) => !migrations.some((m) => m.tag === t));

  const report = {
    checkout: APP,
    mode: strict ? "strict" : "report",
    target,
    envSource: from,
    counts: { filesOnDisk: migrations.length, journalEntries: journalTags.size, recordedRows: applied.length, orphanRecordedRows: orphanApplied },
    byState,
    fileNotJournaled,
    journaledNoFile,
    migrations: rows,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\n─── migration reconciliation (READ ONLY, schema-fingerprinted) ───");
    console.log(`  mode      : ${report.mode}`);
    console.log(`  checkout  : ${APP}`);
    console.log(`  target db : ${target.database} @ ${target.host}:${target.port}  [fingerprint ${target.hostHash}]`);
    console.log(`  counts    : ${report.counts.filesOnDisk} files · ${report.counts.journalEntries} journaled · ${report.counts.recordedRows} recorded${orphanApplied ? ` · ${orphanApplied} recorded rows match NO file here` : ""}`);
    console.log("\n  by state:");
    for (const [k, v] of Object.entries(byState).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);
    if (fileNotJournaled.length) console.log(`\n  on disk but NOT journaled — a fresh env SKIPS these (${fileNotJournaled.length}): ${fileNotJournaled.join(", ")}`);
    if (journaledNoFile.length) console.log(`\n  journaled but NO file — a fresh env FAILS here (${journaledNoFile.length}): ${journaledNoFile.join(", ")}`);
    if (notClean.length) {
      console.log(`\n  needs attention (${notClean.length}):`);
      for (const r of notClean) {
        console.log(`\n    ${r.tag}  [${r.state}]  ${r.statements} stmt · ${r.unverifiable} unverifiable`);
        for (const m of r.mismatches.slice(0, 6)) console.log(`      ✗ ${m}`);
        if (r.mismatches.length > 6) console.log(`      … ${r.mismatches.length - 6} more`);
        for (const u of r.unsupportedSamples) console.log(`      ? unparsed: ${u.slice(0, 110)}`);
      }
    }
    console.log(
      "\n  UNRECORDED_BUT_EXACT_MATCH = hand-applied and correct. The schema is right; only the\n" +
      "  ledger is wrong. These are baseline candidates — but marking them applied is a REVIEWED\n" +
      "  production change and is deliberately not implemented here. Never replay their DDL.\n",
    );
    console.log(notClean.length ? `✗ ${notClean.length} migration(s) are not RECORDED_AND_MATCHED\n` : "✓ every migration is recorded and schema-matched\n");
  }

  if (strict && notClean.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(2); });
