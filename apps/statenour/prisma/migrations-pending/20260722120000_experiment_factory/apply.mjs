// One-shot COLUMN-FIRST executor for 20260722120000_experiment_factory.
// Reads migration.sql (single source of truth), splits into statements while
// respecting DO $$ ... $$ blocks (so the FK guards run whole), applies each via a
// direct pg client (process.env.DATABASE_URL), then verifies the result and that
// pgvector is untouched. Run: railway run --service statenour-web -- node <this>.
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "migration.sql"), "utf8");

/** Split on top-level `;`, treating text inside `$$...$$` as opaque. */
function splitStatements(text) {
  const body = text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  const stmts = [];
  let buf = "";
  let inDollar = false;
  for (let i = 0; i < body.length; i++) {
    if (body.slice(i, i + 2) === "$$") {
      inDollar = !inDollar;
      buf += "$$";
      i++;
      continue;
    }
    const ch = body[i];
    if (ch === ";" && !inDollar) {
      if (buf.trim()) stmts.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) stmts.push(buf.trim());
  return stmts;
}

const statements = splitStatements(sql);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
console.log(`applying ${statements.length} statements...`);
for (const [i, stmt] of statements.entries()) {
  const label = stmt.slice(0, 70).replace(/\s+/g, " ");
  try {
    await c.query(stmt);
    console.log(`  ok   [${i + 1}/${statements.length}] ${label}`);
  } catch (e) {
    console.log(`  FAIL [${i + 1}/${statements.length}] ${label}\n       ${e.message}`);
    await c.end();
    process.exit(1);
  }
}

// Verify: table + columns + FKs + pgvector untouched.
const t = await c.query("SELECT to_regclass('public.experiments') AS t");
const cols = await c.query(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE (table_name='opportunity_logs' AND column_name='source_id')
      OR (table_name='intelligence_sources' AND column_name IN ('auth_score_updated_at','auth_score_samples'))
   ORDER BY table_name, column_name`,
);
const fks = await c.query(
  "SELECT conname FROM pg_constraint WHERE conname IN ('experiments_opportunity_id_fkey','experiments_source_id_fkey') ORDER BY conname",
);
const vec = await c.query("SELECT extname FROM pg_extension WHERE extname='vector'");
console.log("VERIFY:", JSON.stringify({
  experimentsTable: t.rows[0].t,
  addedColumns: cols.rows.map((r) => `${r.table_name}.${r.column_name}`),
  fks: fks.rows.map((r) => r.conname),
  pgvectorPresent: vec.rows.length === 1,
}));
await c.end();
