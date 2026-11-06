/**
 * Customer Promise Ledger (plan PR-6) — every customer-facing promise
 * becomes a durable obligation: who owes it, what exactly, by when, and
 * what happened. Table: customer_promises (0102, hand-applied).
 *
 * Doctrine:
 *   - A promise is KEPT only with evidence text ("texted 3:10pm",
 *     "spoke on phone") — kept_evidence is required, not decorative.
 *   - Overdue promises ESCALATE INTO THE DECISION INBOX (one
 *     promise_overdue opportunity per promise) — not a new alert
 *     channel, and NEVER an automated customer send. Telling the
 *     customer remains a human action; the ledger makes forgetting
 *     structurally impossible instead.
 *   - Graceful degrade until 0102 applies (same ROS-059 discipline).
 */
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";
import { isMissingTableError } from "../lib/dbErrors";

const log = createLogger("promise-ledger");

export const PROMISE_TYPES = [
  "callback",
  "estimate",
  "status_update",
  "parts_arrival",
  "completion_notice",
  "manager_followup",
  "other",
  // ADR-0020 (Q-22): written only by the obligation mirror.
  "reply",
  "emergency_response",
] as const;
export type PromiseType = (typeof PROMISE_TYPES)[number];

/**
 * Source kinds written by the obligation mirror (ADR-0020 §4). Phase 1 runs
 * them in SHADOW: every existing reader below (the open list, the sweep, the
 * kept-rate) leaves them out, so arming `obligation_mirror_enabled` changes no
 * panel, no brief and no Decision Inbox item. Phase 2 and 3 lift this per
 * reader, each behind its own flag.
 *
 * Why the sweep must not see them yet: it escalates every overdue open row into
 * the Inbox, so a mirrored owed text would raise a second alert beside the
 * hourly Telegram that already covers it. Why the list must not: SWEEP_PAGE and
 * the panel both page by due_at, and a week of mirrored rows would push the
 * operator's own promises off the page.
 */
const MIRROR_SOURCE_KINDS = ["callback_request", "owed_reply", "emergency"] as const;
export type MirrorSourceKind = (typeof MIRROR_SOURCE_KINDS)[number];

/**
 * Rows no reader shows: the mirror's shadow kinds, and `voice`, the receptionist's
 * callback promises, retired 2026-11-06 (Nour: the receptionist makes no callback
 * obligations). escalate writes no new ones; this keeps the open ones out of the
 * sweep (no "Promise overdue" row), the panel and the debt card.
 */
const HIDDEN_SOURCE_KINDS = [...MIRROR_SOURCE_KINDS, "voice"] as const;

async function notMirrored() {
  const { sql } = await import("drizzle-orm");
  return sql`source_kind NOT IN (${sql.join(HIDDEN_SOURCE_KINDS.map((k) => sql`${k}`), sql`, `)})`;
}

export const PROMISE_STATUSES = ["open", "kept", "missed", "cancelled"] as const;
export type PromiseStatus = (typeof PROMISE_STATUSES)[number];

/** Pure — exported for tests. Escalation urgency: >4h overdue is a
 *  broken promise in the customer's eyes today; anything overdue is at
 *  least a today-item. */
export function classifyOverdue(dueAt: Date, now: Date): { overdue: boolean; hoursOverdue: number; urgency: "critical" | "today" } {
  const ms = now.getTime() - dueAt.getTime();
  const hoursOverdue = Math.max(0, Math.floor(ms / 3_600_000));
  return {
    overdue: ms > 0,
    hoursOverdue,
    urgency: hoursOverdue >= 4 ? "critical" : "today",
  };
}

let tableMissingWarned = false;
function warnMissingOnce(where: string): void {
  if (!tableMissingWarned) {
    tableMissingWarned = true;
    log.warn(`[promise-ledger] customer_promises table missing (${where}) — apply migration 0102`);
  }
}

export interface PromiseRow {
  id: string;
  promiseType: PromiseType;
  customerName: string | null;
  customerPhone: string | null;
  promisedAction: string;
  owner: string | null;
  dueAt: Date;
  status: PromiseStatus;
  keptAt: Date | null;
  keptEvidence: string | null;
  escalatedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

function rowsFromExecute(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0] as Array<Record<string, unknown>>;
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  return [];
}

function mapRow(r: Record<string, unknown>): PromiseRow {
  return {
    id: String(r.id),
    promiseType: String(r.promise_type) as PromiseType,
    customerName: r.customer_name == null ? null : String(r.customer_name),
    customerPhone: r.customer_phone == null ? null : String(r.customer_phone),
    promisedAction: String(r.promised_action),
    owner: r.owner == null ? null : String(r.owner),
    dueAt: new Date(r.due_at as string),
    status: String(r.status) as PromiseStatus,
    keptAt: r.kept_at == null ? null : new Date(r.kept_at as string),
    keptEvidence: r.kept_evidence == null ? null : String(r.kept_evidence),
    escalatedAt: r.escalated_at == null ? null : new Date(r.escalated_at as string),
    createdBy: String(r.created_by),
    createdAt: new Date(r.created_at as string),
  };
}

export async function createPromise(params: {
  promiseType: PromiseType;
  promisedAction: string;
  dueAt: Date;
  customerName?: string | null;
  customerPhone?: string | null;
  owner?: string | null;
  sourceKind?: string;
  sourceId?: string | null;
  createdBy: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };
  const id = randomUUID();
  try {
    await db.execute(sql`
      INSERT INTO customer_promises
        (id, promise_type, customer_name, customer_phone, source_kind, source_id,
         promised_action, owner, due_at, created_by)
      VALUES
        (${id}, ${params.promiseType}, ${params.customerName ?? null}, ${params.customerPhone ?? null},
         ${params.sourceKind ?? "operator"}, ${params.sourceId ?? null},
         ${params.promisedAction}, ${params.owner ?? null}, ${params.dueAt}, ${params.createdBy})
    `);
    return { ok: true, id };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("create");
      return { ok: false, error: "table not applied (migration 0102)" };
    }
    throw err;
  }
}

/**
 * Strike-3 lifecycle closure: resolving a promise must also close its
 * escalated Decision Inbox row — pre-fix a kept/cancelled/missed promise
 * left the promise_overdue opportunity live, so the inbox kept telling
 * the operator to keep a promise that was already resolved. Best-effort:
 * the ledger row is the source of truth; a failed closure is logged and
 * the queue's own reconcilers get another chance next cron.
 */
async function closePromiseOpportunity(promiseId: string, resolution: string, by: string): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const { transitionOpportunity } = await import("./opportunityQueue");
    const db = await getDb();
    if (!db) return;
    const rows = rowsFromExecute(await db.execute(sql`
      SELECT id FROM revenue_opportunities
      WHERE source_type = 'promise_overdue' AND source_id = ${promiseId}
        AND state NOT IN ('won', 'lost', 'do_not_contact', 'duplicate')
      LIMIT 1
    `));
    if (rows.length === 0) return;
    await transitionOpportunity({
      id: String(rows[0].id),
      to: "lost",
      by,
      note: `promise resolved: ${resolution}`,
    });
  } catch (err) {
    log.warn("[promise-ledger] inbox closure failed (queue reconciler will retry)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Kept requires EVIDENCE — "what did you actually do" is the receipt. */
export async function keepPromise(params: {
  id: string;
  evidence: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!params.evidence || params.evidence.trim().length < 3) {
    return { ok: false, error: "kept requires evidence text (what was actually done)" };
  }
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };
  try {
    const result = await db.execute(sql`
      UPDATE customer_promises
      SET status = 'kept', kept_at = NOW(),
          kept_evidence = ${`${params.evidence.slice(0, 280)} — ${params.by}`}
      WHERE id = ${params.id} AND status = 'open'
    `);
    const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object" ? result[0] : result) as { affectedRows?: number };
    if ((raw.affectedRows ?? 0) === 0) return { ok: false, error: "not found or not open" };
    await closePromiseOpportunity(params.id, `kept — ${params.evidence.slice(0, 80)}`, params.by);
    return { ok: true };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("keep");
      return { ok: false, error: "table not applied (migration 0102)" };
    }
    throw err;
  }
}

export async function cancelPromise(params: { id: string; by: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };
  try {
    const result = await db.execute(sql`
      UPDATE customer_promises
      SET status = 'cancelled', kept_evidence = ${`cancelled by ${params.by}`}
      WHERE id = ${params.id} AND status = 'open'
    `);
    const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object" ? result[0] : result) as { affectedRows?: number };
    if ((raw.affectedRows ?? 0) === 0) return { ok: false, error: "not found or not open" };
    await closePromiseOpportunity(params.id, "cancelled", params.by);
    return { ok: true };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("cancel");
      return { ok: false, error: "table not applied (migration 0102)" };
    }
    throw err;
  }
}

export async function listOpenPromises(limit = 100): Promise<PromiseRow[]> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return [];
  try {
    const result = await db.execute(sql`
      SELECT * FROM customer_promises WHERE status = 'open' AND ${await notMirrored()}
      ORDER BY due_at ASC LIMIT ${Math.min(limit, 500)}
    `);
    return rowsFromExecute(result).map(mapRow);
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("list");
      return [];
    }
    throw err;
  }
}

/**
 * Q-23 phase 3 · obligation debt for the admin "Today, for real" card: how many
 * promises are open, how many are past due, and how many are 4h+ past due (the
 * sweep's `critical` line in classifyOverdue). Same row set as listOpenPromises,
 * and the mirror stays in shadow. PromisesPanel lists at most 50 of those rows
 * and its header says "50+ open" when the page is full, so the panel and the
 * card do not contradict each other.
 *
 * A failed read or an un-applied table is `available: false`, never zeros: a
 * card that shows "0 owed" when it could not look is how a forgotten callback
 * hides. `due_at` is a TIMESTAMP, so comparing it with NOW() in SQL is
 * timezone-safe; no instant crosses the driver.
 */
export type PromiseDebt =
  | { available: true; open: number; overdue: number; overdue4h: number }
  | { available: false; reason: string };

export async function promiseDebt(): Promise<PromiseDebt> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { available: false, reason: "DB unavailable" };
  try {
    const rows = rowsFromExecute(await db.execute(sql`
      SELECT
        COUNT(*) AS open,
        COALESCE(SUM(due_at < NOW()), 0) AS overdue,
        COALESCE(SUM(due_at < DATE_SUB(NOW(), INTERVAL 4 HOUR)), 0) AS overdue4h
      FROM customer_promises
      WHERE status = 'open' AND ${await notMirrored()}
    `));
    const r = rows[0];
    if (!r) return { available: false, reason: "count returned no row" };
    return {
      available: true,
      open: Number(r.open ?? 0),
      overdue: Number(r.overdue ?? 0),
      overdue4h: Number(r.overdue4h ?? 0),
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("debt");
      return { available: false, reason: "table not applied (migration 0102)" };
    }
    log.warn("[promise-ledger] debt read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { available: false, reason: "read failed" };
  }
}

/**
 * Cron sweep: overdue open promises escalate ONCE into the Decision
 * Inbox (promise_overdue opportunity per promise; ≥4h overdue =
 * critical). Also marks promises `missed` after 48h overdue without
 * action — the ledger tells the truth about broken promises instead of
 * letting them rot as "open".
 */
/**
 * How many open promises one sweep examines. The page is fine; reporting it as
 * if it were the total is not — see the disclosure in the return value below.
 */
const SWEEP_PAGE = 200;

/**
 * The true number of open promises, which is NOT the same as the number the
 * sweep looked at.
 *
 * This mattered very little while every promise was typed by hand — the table
 * never approached 200 rows. Voice capture changes that: a promise is now
 * created per qualifying call, so the open set can genuinely exceed the page.
 * A reader assumption that was safe for a hand-typed table is not safe for an
 * auto-populated one, and the reader was not revisited when the writer changed.
 */
async function countOpenPromises(): Promise<number | null> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = rowsFromExecute(await db.execute(sql`
      SELECT COUNT(*) AS n FROM customer_promises WHERE status = 'open' AND ${await notMirrored()}
    `));
    const n = rows[0]?.n;
    return n == null ? null : Number(n);
  } catch {
    // A failed count must not fail the sweep. Null means "unknown", and the
    // caller says so rather than substituting the page size for the total.
    return null;
  }
}

export async function sweepOverduePromises(): Promise<{ recordsProcessed: number; details: string }> {
  const open = await listOpenPromises(SWEEP_PAGE);
  if (open.length === 0) return { recordsProcessed: 0, details: "no open promises" };

  const now = new Date();
  const { upsertOpportunity } = await import("./opportunityQueue");
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();

  let escalated = 0;
  let markedMissed = 0;
  for (const p of open) {
    const o = classifyOverdue(p.dueAt, now);
    if (!o.overdue) continue;

    // Escalate once per promise.
    if (!p.escalatedAt) {
      const res = await upsertOpportunity({
        sourceType: "promise_overdue",
        sourceId: p.id,
        customerName: p.customerName,
        customerPhone: p.customerPhone,
        expectedRevenueCents: null, // a promise is trust, not a forecast
        dataQuality: "verified",    // WE made the promise — that's a fact
        urgency: o.urgency,
        recommendedAction: `Keep the promise${p.customerName ? ` to ${p.customerName}` : ""}: ${p.promisedAction}`,
        reason: `${p.promiseType.replace("_", " ")} promised by ${p.owner ?? p.createdBy}, due ${p.dueAt.toISOString().slice(0, 16).replace("T", " ")} — ${o.hoursOverdue}h overdue.`,
        evidence: { promiseId: p.id, promiseType: p.promiseType, hoursOverdue: o.hoursOverdue, owner: p.owner },
        consentOk: true, // keeping a promise the customer was given
      });
      if (res !== "unavailable" && db) {
        escalated++;
        try {
          await db.execute(sql`UPDATE customer_promises SET escalated_at = NOW() WHERE id = ${p.id} AND escalated_at IS NULL`);
        } catch (e) {
          log.warn("[promise-ledger] escalated_at stamp failed", { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    // 48h overdue with no action → the honest status is missed.
    if (o.hoursOverdue >= 48 && db) {
      try {
        const result = await db.execute(sql`
          UPDATE customer_promises SET status = 'missed' WHERE id = ${p.id} AND status = 'open'
        `);
        const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object" ? result[0] : result) as { affectedRows?: number };
        if ((raw.affectedRows ?? 0) > 0) {
          markedMissed++;
          // The ledger recorded the miss — stop the inbox nagging about a
          // promise that is officially dead. History lives in the ledger.
          await closePromiseOpportunity(p.id, "officially MISSED after 48h overdue", "promise-sweep");
        }
      } catch (e) {
        log.warn("[promise-ledger] missed stamp failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // REPORT THE TOTAL, AND SAY SO WHEN IT EXCEEDS WHAT WAS EXAMINED.
  //
  // This used to read `${open.length} open`, which is the PAGE SIZE, not the
  // number of open promises. At 500 open it would have reported "200 open" —
  // not a truncation warning but a wrong total wearing the costume of a
  // measurement, in the one line an operator reads to decide whether the
  // ledger is healthy.
  //
  // The queue itself degrades gracefully: ORDER BY due_at ASC puts the
  // most-overdue in the examined page, and rows leave the open set as they
  // flip to missed, so later runs reach the rest. The defect was never a stuck
  // queue — it was an instrument that under-reported while everything appeared
  // to work, which is the version that survives review.
  const totalOpen = await countOpenPromises();
  const openLabel =
    totalOpen == null
      ? `${open.length} examined (total unknown — the count query failed)`
      : totalOpen > open.length
        ? `${totalOpen} open · only the ${open.length} most overdue examined this run, the rest wait for the next`
        : `${totalOpen} open`;

  return {
    recordsProcessed: escalated + markedMissed,
    details: `${openLabel} · ${escalated} escalated to inbox · ${markedMissed} marked missed (48h+)`,
  };
}


/**
 * Ledger truth for the adoption questions (Strike-3): created / kept on
 * time / kept late / missed / cancelled over a window, plus average
 * overdue hours for late keeps. Pure aggregation — no invented rates.
 */
/**
 * The kept-rate — OPERATOR-SOURCED promises only. Voice promises are excluded
 * by the `source_kind <> 'voice'` clause below, and that exclusion is the most
 * important line in this function.
 *
 * A promise is only ever marked kept by an operator pressing Keep in the admin
 * panel: `keepPromise` has exactly one caller. The actual callback happens on
 * the counter phone or a personal cell, which this system cannot observe, so
 * there is NO automatic keeping signal for a voice-sourced promise.
 *
 * Including them would let auto-created promises accumulate and sweep to
 * `missed` after 48h regardless of whether the shop really called back — the
 * brief would tell Nick he had broken dozens of promises when the truth is that
 * keeping was never measurable. A ratio whose denominator fills automatically
 * and whose numerator can only be produced by hand measures how often somebody
 * clicked a button, not how the shop behaved.
 *
 * Unmeasured is not failed. Voice promises are retired (2026-11-06): the
 * receptionist makes none, and the open ones are hidden from every reader.
 */
export async function promiseLedgerStats(windowDays = 30): Promise<{
  created: number;
  keptOnTime: number;
  keptLate: number;
  missed: number;
  cancelled: number;
  open: number;
  avgKeptLateHours: number | null;
} | null> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = rowsFromExecute(await db.execute(sql`
      SELECT
        COUNT(*) AS created,
        SUM(status = 'kept' AND kept_at <= due_at) AS keptOnTime,
        SUM(status = 'kept' AND kept_at > due_at) AS keptLate,
        SUM(status = 'missed') AS missed,
        SUM(status = 'cancelled') AS cancelled,
        SUM(status = 'open') AS open,
        AVG(CASE WHEN status = 'kept' AND kept_at > due_at
                 THEN TIMESTAMPDIFF(HOUR, due_at, kept_at) END) AS avgKeptLateHours
      FROM customer_promises
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
        AND source_kind <> 'voice'
        AND ${await notMirrored()}
    `));
    const r = rows[0] ?? {};
    return {
      created: Number(r.created ?? 0),
      keptOnTime: Number(r.keptOnTime ?? 0),
      keptLate: Number(r.keptLate ?? 0),
      missed: Number(r.missed ?? 0),
      cancelled: Number(r.cancelled ?? 0),
      open: Number(r.open ?? 0),
      avgKeptLateHours: r.avgKeptLateHours == null ? null : Math.round(Number(r.avgKeptLateHours)),
    };
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}
