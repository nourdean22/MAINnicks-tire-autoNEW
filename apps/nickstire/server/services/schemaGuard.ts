/**
 * Boot-time loud check for code-expected tables.
 *
 * WHY THIS EXISTS (ROS-059)
 * Migrations here are hand-applied. On 2026-07-21 the durable inbound-response
 * spine shipped with `drizzle/0092`; the migration was never applied to prod, so
 * `sms_response_jobs` did not exist and every inbound customer text quietly took
 * the spine's direct-orchestrate fallback for four days. Customers were answered,
 * so nothing looked broken — but the restart-survival guarantee the table exists
 * for was never active. It surfaced only because someone happened to run an
 * information_schema query while applying an unrelated DDL.
 *
 * That is the silent-IDLE class: a fallback written to be quiet is indistinguishable
 * from a system that is working. Every table below has a verified call site that
 * degrades WITHOUT failing — a warn among thousands of log lines, a `return null`,
 * an in-memory substitute. This module makes that condition loud exactly once at
 * boot, and keeps the answer readable so /api/health can report it.
 *
 * DESIGN CONSTRAINTS
 * - NEVER throws and never blocks boot. A false positive here must not take the
 *   site down; the check is diagnostic, not a gate.
 * - One query for all tables (information_schema, indexed on schema+name).
 * - Absence is reported per-table with the CONSEQUENCE and the migration that
 *   fixes it, because "table missing" alone does not tell an operator what broke.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("schema-guard");

export interface CriticalTable {
  /** Exact SQL table name (verified against drizzle/schema.ts). */
  table: string;
  /**
   * What silently stops working when it is absent. Every entry below was read
   * from its call site — this is the field an operator acts on, so a guess here
   * would make the guard itself a source of false information.
   */
  consequence: string;
  /** The migration that creates it, relative to apps/nickstire/. */
  migration: string;
}

/**
 * Tables whose absence is SILENT. This is deliberately not "every table" — a table
 * whose absence throws is already loud, and listing it here would dilute the signal.
 * The bar for adding an entry: a call site that catches, logs below error level or
 * not at all, and returns a benign value.
 */
export const CRITICAL_TABLES: CriticalTable[] = [
  {
    table: "sms_response_jobs",
    consequence:
      "Inbound texts are answered in-process only — the obligation to reply does NOT survive a restart, and no sweep re-answers a dropped one. (ROS-059: ran undetected for 4 days.)",
    migration: "drizzle/0092_sms_response_jobs.sql (+ 0097 for the human_pending enum)",
  },
  {
    table: "business_facts",
    consequence:
      "getFact() falls back to code SEED_FACTS, so every operator fact edit — warranty terms, pricing bands — silently never reaches the live SMS prompt.",
    migration: "drizzle/0093_business_facts.sql",
  },
  {
    table: "expected_arrivals",
    consequence:
      "recordExpectedArrival() returns null, so voice/SMS 'I'll come by today' records are lost and the arrival -> paid-invoice revenue chain cannot reconcile.",
    migration: "drizzle/0094_expected_arrivals.sql",
  },
  {
    table: "cron_locks",
    consequence:
      "Cron falls back to in-memory locks, so every scheduled job can run concurrently on multiple dynos (duplicate sends, duplicate writes).",
    migration: "drizzle/0037_wave168_cron_locks.sql",
  },
  {
    table: "abandoned_forms",
    consequence: "Abandoned-form capture no-ops entirely; recoverable leads are dropped without a trace.",
    migration: "drizzle/0081_abandoned_forms.sql",
  },
  {
    table: "service_affinity_predictions",
    consequence: "The service-affinity cron skips every run, so cross-sell predictions are never computed.",
    migration: "drizzle/0061_service_affinity_v2.sql",
  },
];

export interface SchemaAuditResult {
  /** null when the audit could not run (no DB) — distinct from "nothing missing". */
  ranAt: string;
  ok: boolean;
  checked: number;
  missing: CriticalTable[];
  /** Set when the audit itself failed; `missing` is then meaningless. */
  error?: string;
}

let lastAudit: SchemaAuditResult | null = null;

/** The most recent audit, for /api/health. null = never ran. */
export function getLastSchemaAudit(): SchemaAuditResult | null {
  return lastAudit;
}

/** Backoff between boot retries: the pool is usually ready within seconds. */
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];

/**
 * Boot entry point: audit, and retry if the audit could not RUN.
 *
 * At boot the guard races the database pool, so a cold start can report "no
 * database connection" — indistinguishable from a real outage and, without this,
 * cached as `unknown` until the next deploy. That would quietly defeat the guard
 * on exactly the restarts it exists to cover.
 *
 * Only a failure to RUN is retried. A successful audit that FOUND missing tables
 * is a real answer; re-running it would just repeat the alarm.
 */
export async function auditCriticalTablesWithRetry(
  /** Overridable so tests exercise the retry logic without sleeping for real. */
  delaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<SchemaAuditResult> {
  let result = await auditCriticalTables();
  for (const delay of delaysMs) {
    if (!result.error) return result; // ran successfully — ok or not, it is an answer
    log.warn(`Schema guard could not run; retrying in ${Math.round(delay / 1000)}s`, { error: result.error });
    await new Promise((r) => setTimeout(r, delay));
    result = await auditCriticalTables();
  }
  if (result.error) {
    log.error("Schema guard never completed — critical-table state stays UNKNOWN until the next restart", {
      error: result.error,
      errorId: "SCHEMA_GUARD_UNRESOLVED",
    });
  }
  return result;
}

/**
 * Check every critical table in one query and log LOUD for each absence.
 *
 * Returns the result and caches it. Never throws: an audit that cannot run reports
 * `error` and `ok: false`, which is honest — "we do not know" must not render as
 * "everything is fine" (the same distinction #953 drew for the opt-out index).
 */
export async function auditCriticalTables(): Promise<SchemaAuditResult> {
  const ranAt = new Date().toISOString();
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      lastAudit = { ranAt, ok: false, checked: 0, missing: [], error: "no database connection" };
      return lastAudit;
    }

    const names = CRITICAL_TABLES.map((t) => t.table);
    // DATABASE() scopes to the connected schema, so this cannot read a sibling
    // database's tables and report a false pass.
    const [rows] = await db.execute(sql`
      SELECT TABLE_NAME AS name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})
    `);
    const present = new Set((rows as Array<{ name: string }>).map((r) => r.name));
    const missing = CRITICAL_TABLES.filter((t) => !present.has(t.table));

    for (const t of missing) {
      log.error(`REQUIRED TABLE MISSING: ${t.table} — ${t.consequence} Apply ${t.migration}, then restart.`, {
        table: t.table,
        migration: t.migration,
        errorId: "REQUIRED_TABLE_MISSING",
      });
    }
    if (missing.length === 0) {
      log.info("Schema guard: all critical tables present", { checked: names.length });
    } else {
      log.error(
        `Schema guard: ${missing.length} of ${names.length} critical tables are MISSING — features above are running degraded and SILENT.`,
        { missing: missing.map((m) => m.table), errorId: "SCHEMA_GUARD_DEGRADED" },
      );
    }

    lastAudit = { ranAt, ok: missing.length === 0, checked: names.length, missing };
    return lastAudit;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Diagnostic only — a failed audit must never stop the server from booting.
    log.error("Schema guard could not run; critical-table state is UNKNOWN", {
      error,
      errorId: "SCHEMA_GUARD_FAILED",
    });
    lastAudit = { ranAt, ok: false, checked: 0, missing: [], error };
    return lastAudit;
  }
}
