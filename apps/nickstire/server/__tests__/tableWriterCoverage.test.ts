/**
 * Reader-with-no-writer canary (2026-09-01 admin audit, artifact 1 §3–§4).
 *
 * The audit's most reliable detector was "this table has readers and NO
 * writer anywhere in the repo" — TiDB tables can only be written by code in
 * this repo, so the closure property holds. It found `payments` (read in the
 * refund fallback), `kpi_snapshots` (a trend endpoint that returned [] for
 * the life of the table) and `customer_testimonials` (read by the evidence
 * engine). The raw detector had a 50% false-positive rate until raw-SQL
 * writers (`INSERT INTO snake_case`) were scanned alongside Drizzle
 * identifiers — this test scans both spellings.
 *
 * Contract: every Drizzle table either has at least one writer in server/ or
 * scripts/ (Drizzle insert/update, or raw INSERT/UPDATE/REPLACE), or is named
 * in KNOWN_WRITERLESS with a reason. Both directions are asserted: a table
 * that gains a writer must leave the allowlist (a stale allowlist entry is a
 * failure), and a positive control proves the scanner sees real writers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const APP = join(__dirname, "..", "..");

/**
 * Tables with no statically visible writer today, each with the reason. Two
 * classes live here and must not be confused:
 *   · INDIRECTION — written for real, but through `insert(ctx.table)` where the
 *     table object is passed as a variable; a static scan cannot see it. Hand-
 *     verified 2026-09-02 (generationLedger.ts:106-172, contentGovernor).
 *   · DEAD / WRITERLESS — the audit class. Retirement candidates.
 * The first run of this canary (2026-09-02) found the eight non-audit entries;
 * the audit's own scan had only listed tables that HAD readers, so fully-dead
 * tables never appeared (correction #15 in artifact 1).
 */
const KNOWN_WRITERLESS: Record<string, string> = {
  // audit findings
  payments: "F-3 · read once as the refund-lookup fallback; a writer never existed. Retire or wire (audit 2026-09-01).",
  customer_testimonials: "F-5 · created on demand and read by the evidence engine; no entry surface was ever built.",
  vehicles: "F-16 · zero readers and zero writers since the monorepo began; retired by 0117 (operator-gated).",
  inventory: "artifact 4 §2.7 · no inventory loop exists; the low-stock cron reads it with a 'no table' fallback.",
  // INDIRECTION — written via insert(ctx.table); see generationLedger.ts:106 (`schema.generationReservations`) and contentGovernor
  generation_reservations: "INDIRECTION · written by generationLedger.ts through insert(ctx.table); verified by hand 2026-09-02.",
  content_reservations: "INDIRECTION · written by contentGovernor/commandCenter through a table variable; verified by hand 2026-09-02.",
  // F-24 (2026-09-02, found by this canary) — documented-writerless and fully dead tables
  estimates_log: "F-24 · the web AI-estimator funnel table; controlCenter.ts:119 and estimates.ts:31 both document that it has no writer. Its 'readers' are those comments.",
  form_abandonment: "F-24 · dead twin of abandoned_forms; the only reference is a sourceTable string in smsOrchestrator.",
  error_log: "F-24 · dead — no readers, no writers, no references.",
  waitlist: "F-24 · dead — the waitlist router was deleted; a rate-limiter registration for 'waitlist.join' and a registry alias survive.",
  webhook_deliveries: "F-24 · dead — no readers, no writers, no references.",
  chat_analytics: "F-24 · dead — provisioned by a CREATE TABLE IF NOT EXISTS in nick/intelligence.ts, never written or read.",
  user_roles: "F-24 · dead — no readers, no writers; roles live in admin_security.",
};

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) listSourceFiles(full, out);
    else if (/\.(ts|mts|mjs|js)$/.test(name) && !/\.test\.[a-z]+$/.test(name)) out.push(full);
  }
  return out;
}

function tableMap(): Map<string, string> {
  const schema = readFileSync(join(APP, "drizzle", "schema.ts"), "utf8");
  const out = new Map<string, string>();
  for (const m of schema.matchAll(/^export const ([A-Za-z0-9_]+) = mysqlTable\("([a-z0-9_]+)"/gm)) out.set(m[1], m[2]);
  return out;
}

/**
 * Every table each file writes, collected in ONE pass per file. The scan used
 * to run two regexes per table over every file (~150 tables x ~1,500 files):
 * 13s in a quiet process and past the 30s test timeout in a heap-heavy shuffled
 * order (seed 29, 2026-09-23). The matching rules are unchanged:
 *   · Drizzle: `.insert(x)` / `.update(x)` / `.delete(x)`, and the qualified
 *     `.insert(schema.x)` form the ledger services use (the first run of this
 *     canary missed it and reported four live tables as writerless). Both the
 *     head and the qualified tail are recorded, as the old per-table regex
 *     matched either.
 *   · Raw SQL: INSERT [IGNORE] INTO / UPDATE / REPLACE INTO / DELETE FROM,
 *     optional backticks, case-insensitive.
 */
const DRIZZLE_WRITE = /\.(?:insert|update|delete)\(\s*([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g;
const RAW_WRITE = /\b(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|REPLACE\s+INTO|DELETE\s+FROM)\s+`?([A-Za-z0-9_]+)/gi;

type FileWrites = { file: string; idents: Set<string>; tables: Set<string> };
const writesCache = new Map<string, FileWrites>();

function writesOf(file: string): FileWrites {
  const hit = writesCache.get(file);
  if (hit) return hit;
  const text = readFileSync(file, "utf8");
  const idents = new Set<string>();
  const tables = new Set<string>();
  for (const m of text.matchAll(DRIZZLE_WRITE)) {
    idents.add(m[1]);
    if (m[2]) idents.add(m[2]);
  }
  for (const m of text.matchAll(RAW_WRITE)) tables.add(m[1].toLowerCase());
  const out = { file: relative(APP, file), idents, tables };
  writesCache.set(file, out);
  return out;
}

function findWriters(sources: string[], ident: string, dbName: string): string[] {
  return sources.map(writesOf).filter((w) => w.idents.has(ident) || w.tables.has(dbName.toLowerCase())).map((w) => w.file);
}

describe("every Drizzle table has a writer, or a reason it does not", () => {
  const sources = [...listSourceFiles(join(APP, "server")), ...listSourceFiles(join(APP, "scripts"))];
  const tables = tableMap();

  it("positive control — the scanner sees real writers (Drizzle and raw SQL)", () => {
    expect(findWriters(sources, "leads", "leads").length).toBeGreaterThan(0);
    // customer_metrics is written ONLY by raw SQL — the case the Drizzle-only scan missed.
    expect(findWriters(sources, "customerMetrics", "customer_metrics").length).toBeGreaterThan(0);
    // kpi_snapshots gained its writer in the audit wave (kpiSnapshot job, raw INSERT).
    expect(findWriters(sources, "kpiSnapshots", "kpi_snapshots").length).toBeGreaterThan(0);
  });

  it("no table outside KNOWN_WRITERLESS is read-only for the whole repo", () => {
    const writerless: string[] = [];
    for (const [ident, dbName] of tables) {
      if (dbName in KNOWN_WRITERLESS) continue;
      if (findWriters(sources, ident, dbName).length === 0) writerless.push(dbName);
    }
    expect(
      writerless,
      `tables with NO writer anywhere in server/ or scripts/ (a reader-with-no-writer, audit F-3/F-4/F-5 class) — wire a writer, or add to KNOWN_WRITERLESS with a reason: ${writerless.join(", ")}`,
    ).toEqual([]);
  });

  it("the allowlist is not stale — a table that gained a writer must leave it", () => {
    const stale: string[] = [];
    for (const [dbName] of Object.entries(KNOWN_WRITERLESS)) {
      const ident = [...tables].find(([, db]) => db === dbName)?.[0];
      if (!ident) { stale.push(`${dbName} (no longer in schema)`); continue; }
      if (findWriters(sources, ident, dbName).length > 0) stale.push(`${dbName} (now has a writer)`);
    }
    expect(stale, `KNOWN_WRITERLESS entries that are no longer true: ${stale.join(", ")}`).toEqual([]);
  });
});
