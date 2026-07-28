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

const log = createLogger("promise-ledger");

export const PROMISE_TYPES = [
  "callback",
  "estimate",
  "status_update",
  "parts_arrival",
  "completion_notice",
  "manager_followup",
  "other",
] as const;
export type PromiseType = (typeof PROMISE_TYPES)[number];

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
function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /doesn'?t exist|ER_NO_SUCH_TABLE|1146/i.test(msg);
}
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
      SELECT * FROM customer_promises WHERE status = 'open'
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
 * Cron sweep: overdue open promises escalate ONCE into the Decision
 * Inbox (promise_overdue opportunity per promise; ≥4h overdue =
 * critical). Also marks promises `missed` after 48h overdue without
 * action — the ledger tells the truth about broken promises instead of
 * letting them rot as "open".
 */
export async function sweepOverduePromises(): Promise<{ recordsProcessed: number; details: string }> {
  const open = await listOpenPromises(200);
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
        if ((raw.affectedRows ?? 0) > 0) markedMissed++;
      } catch (e) {
        log.warn("[promise-ledger] missed stamp failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return {
    recordsProcessed: escalated + markedMissed,
    details: `${open.length} open · ${escalated} escalated to inbox · ${markedMissed} marked missed (48h+)`,
  };
}
