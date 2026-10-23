/**
 * scripts/brain-hygiene/_run.ts - shared runner for the three brain hygiene scripts.
 *
 * Three modes, picked by EXACT argv tokens (anything else is refused, so
 * `--execute=false`, `--EXECUTE`, `-x` and `--exec` can never write):
 *
 *   (no flag)              PLAN. Prints the host from DATABASE_URL (hostname only), then every
 *                          statement the script would run, and returns BEFORE any connection is
 *                          opened. Safe with a bogus or missing DATABASE_URL.
 *   --read                 Opens a connection, runs SELECTs only, prints counts and ids (never
 *                          row text), returns before any write.
 *   --execute --expect=N   Backup first, compare-and-swap, count check, prints the rollback SQL.
 *                          N is the candidate count the operator approved; a different count
 *                          aborts before the first write.
 *
 * No .env file is loaded: the environment is whatever the caller injected
 * (`railway run -s statenour-web -- pnpm exec tsx scripts/brain-hygiene/<x>.ts`).
 * Prisma is imported lazily inside realConnect() so the plan mode never loads it.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type Mode = "plan" | "read" | "execute";
export type Parsed = { ok: true; mode: Mode; expect: number | null } | { ok: false; error: string };

/** Minimal database surface the scripts use; tests inject a fake. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  exec(sql: string, ...params: unknown[]): Promise<number>;
}

export interface Connection {
  db: Db;
  close(): Promise<void>;
}

export interface HygieneSpec {
  name: string;
  /** Statements and rules printed by the plan mode. Pure text, no I/O. */
  plan(): string[];
  /** SELECT only. Returns the candidate count plus summary lines (counts and ids, never row text). */
  read(db: Db, deps?: unknown): Promise<{ count: number; lines: string[] }>;
  /** The write path. Must back up, compare-and-swap, count, and print the rollback. Returns a process exit code. */
  execute(db: Db, ctx: { expect: number; today: string; log: (s: string) => void }, deps?: unknown): Promise<number>;
}

export function parseArgs(argv: readonly string[]): Parsed {
  let read = false;
  let execute = false;
  let expect: number | null = null;
  for (const a of argv) {
    if (a === "--read") read = true;
    else if (a === "--execute") execute = true;
    else if (/^--expect=\d{1,9}$/.test(a)) expect = Number(a.slice("--expect=".length));
    else return { ok: false, error: `unknown argument ${JSON.stringify(a.slice(0, 40))} (allowed: --read, --execute, --expect=N)` };
  }
  if (read && execute) return { ok: false, error: "--read and --execute are mutually exclusive" };
  if (execute && expect === null) {
    return { ok: false, error: "--execute needs --expect=N, the candidate count you approved (run --read first)" };
  }
  if (!execute && expect !== null) return { ok: false, error: "--expect only applies to --execute" };
  return { ok: true, mode: execute ? "execute" : read ? "read" : "plan", expect };
}

/** Hostname only. Never echoes the URL, so credentials cannot reach the log. */
export function dbHost(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL;
  if (!url) return "(unset)";
  try {
    return new URL(url).hostname || "(no host)";
  } catch {
    return "(unparseable)";
  }
}

/** yyyymmdd in UTC, for the backup table name. */
export function stamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

const BACKUP_NAME = /^_bak_[a-z0-9_]{3,50}$/;
export function backupName(table: string, op: string, today: string): string {
  const name = `_bak_${table}_${op}_${today}`;
  if (!BACKUP_NAME.test(name)) throw new Error(`invalid backup table name ${name}`);
  return name;
}

/** Fails closed: a missing or malformed count never reads as zero. */
export function toCount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`count missing or malformed (${String(v)})`);
  return n;
}

export async function backupExists(db: Db, name: string): Promise<boolean> {
  const rows = await db.query<{ present: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS present`, `public.${name}`);
  return rows[0]?.present === true;
}

/** Real connection: lazy imports, the same Neon adapter lib/prisma.ts uses. */
export async function realConnect(): Promise<Connection> {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
  return {
    db: {
      query: (sql, ...params) => prisma.$queryRawUnsafe(sql, ...params) as Promise<never>,
      exec: (sql, ...params) => prisma.$executeRawUnsafe(sql, ...params),
    },
    close: () => prisma.$disconnect(),
  };
}

export async function runHygiene(
  spec: HygieneSpec,
  argv: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env,
  connect: () => Promise<Connection> = realConnect,
  log: (s: string) => void = (s) => console.log(s),
): Promise<number> {
  const parsed = parseArgs(argv);
  log(`database host : ${dbHost(env)}`);
  if (!parsed.ok) {
    log(`REFUSED: ${parsed.error}`);
    return 2;
  }
  log(`script        : ${spec.name}`);
  log(`mode          : ${parsed.mode.toUpperCase()}`);

  if (parsed.mode === "plan") {
    // The guard: this return happens before connect() is referenced.
    for (const line of spec.plan()) log(line);
    log("\nPLAN ONLY: no connection opened, nothing read, nothing written. --read for counts and ids.");
    return 0;
  }

  const conn = await connect();
  try {
    const { count, lines } = await spec.read(conn.db);
    for (const l of lines) log(l);
    if (parsed.mode === "read") {
      log("\nREAD ONLY: nothing written.");
      return 0;
    }
    if (count !== parsed.expect) {
      log(`ABORT: candidate count is ${count}, --expect=${parsed.expect}. Nothing written. Re-run --read and re-approve.`);
      return 1;
    }
    return await spec.execute(conn.db, { expect: parsed.expect, today: stamp(), log });
  } finally {
    await conn.close();
  }
}

/** True when this file was started as the entry point (not imported by a test). */
export function isEntry(metaUrl: string): boolean {
  return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

/** Exit without cutting off buffered output: set the code, let the loop drain, and force exit only if something keeps it alive. */
export function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 500).unref();
}

/** An unexpected throw prints its message only (never a stack that could carry connection details) and exits 1. */
export function fail(e: unknown): void {
  console.error(`FAILED: ${e instanceof Error ? e.message.slice(0, 300) : "unknown error"}`);
  finish(1);
}
