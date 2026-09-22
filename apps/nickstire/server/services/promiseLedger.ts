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
/**
 * A UNIQUE-constraint rejection. Migration 0125 put uq_promise_source on
 * (source_kind, source_id, promise_type), which means the DATABASE now refuses
 * the duplicate that createVoicePromise's read-then-write could not catch
 * between two concurrent webhook deliveries.
 *
 * That is the point of the index — but it relocates the failure from the data
 * into control flow. Before 0125 a race produced two rows and no error; after
 * it, one row and a thrown ER_DUP_ENTRY. The caller has to be taught that this
 * particular throw is not a failed write, it is someone else's successful one.
 */
function isDuplicateKeyError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "ER_DUP_ENTRY") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ER_DUP_ENTRY|Duplicate entry|\b1062\b/i.test(msg);
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
/**
 * A SHOP COMMITMENT made on a voice call becomes a promise. A customer
 * REQUEST does not.
 *
 * Those are different facts and this repo already keeps them in different
 * places. A caller saying "can someone ring me back?" is a request, and it is
 * already recorded as a `callbackRequests` row — an intake queue. It is NOT a
 * promise, because nobody has yet accepted responsibility or named a time.
 *
 * This function is for the other case: the assistant OFFERED and the customer
 * accepted, so the shop now owes the call. Only the two tool paths where that
 * offer is scripted may call it (`escalate`, `scheduleCallback`) — never a
 * classifier outcome like `callback_needed`, which only proves the caller
 * wanted one.
 *
 * TWO REFUSALS ARE THE POINT:
 *
 * 1. NO DERIVABLE DUE TIME, NO PROMISE. `due_at` is what the ledger scores
 *    kept-vs-missed against, so an invented deadline manufactures a breach the
 *    shop never agreed to. When the hours config cannot yield a next-open
 *    instant, this returns `skipped` and the `callbackRequests` row remains the
 *    (untimed) obligation. That is the honest degradation.
 *
 * 2. IDEMPOTENT ON THE CALL. VAPI redelivers webhooks, and the eval cron can
 *    re-read the same call. Without a guard, one promise becomes three and the
 *    kept-rate denominator silently inflates. Dedupe is on
 *    (source_kind, source_id, promise_type).
 *
 * The dedupe is currently a read-then-write, which closes sequential retries
 * (the common case) but NOT two truly concurrent deliveries. Migration 0103
 * adds the UNIQUE index that makes it race-proof; until an operator applies it
 * this remains best-effort, and that limit is stated rather than hidden.
 */
/**
 * Voice-sourced promises, counted as a BACKLOG rather than scored as a rate.
 *
 * These are obligations the shop took on during a call. They are real, and the
 * open ones genuinely need working. What they are NOT is a performance measure,
 * because nothing can mark them kept automatically: `keepPromise` is only ever
 * reached by an operator pressing Keep, and the actual callback happens on the
 * counter phone or a cell this system cannot see.
 *
 * So this returns counts and deliberately NO kept-rate. A ratio whose numerator
 * can only be produced by hand and whose denominator fills automatically is not
 * a measurement of the shop — it is a measurement of how often somebody
 * remembered to click a button.
 */
export async function voicePromiseBacklog(windowDays = 30): Promise<{
  created: number;
  open: number;
  /** Open AND past due — the ones an operator should actually chase. */
  overdue: number;
  /** Swept to `missed` by the cron. NOT evidence the shop failed to call. */
  sweptMissed: number;
  keptByHand: number;
} | null> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = rowsFromExecute(await db.execute(sql`
      SELECT
        COUNT(*) AS created,
        SUM(status = 'open') AS open,
        SUM(status = 'open' AND due_at < NOW()) AS overdue,
        SUM(status = 'missed') AS sweptMissed,
        SUM(status = 'kept') AS keptByHand
      FROM customer_promises
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
        AND source_kind = 'voice'
    `));
    const r = rows[0] ?? {};
    return {
      created: Number(r.created ?? 0),
      open: Number(r.open ?? 0),
      overdue: Number(r.overdue ?? 0),
      sweptMissed: Number(r.sweptMissed ?? 0),
      keptByHand: Number(r.keptByHand ?? 0),
    };
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

/**
 * The voice-promise line of the promises block. Pure, so the three states it
 * has to keep apart can be asserted directly instead of through a cron run.
 *
 * WHY IT IS A FUNCTION AT ALL. The first version of this rendered a failed
 * read, an un-applied table and a genuine zero as the same silence. That is the
 * highest-frequency defect shape in this repo, and it is worse than usual here
 * for two reasons. First, the whole point of capturing voice promises is that
 * obligations cannot be forgotten — so a section that vanishes when capture
 * breaks looks exactly like "no commitments were made". Second, promisesBlock
 * is not only read by Nick: it is interpolated into the LLM prompt that WRITES
 * the brief, so the model would read the silence and state the zero in prose.
 *
 * A measured zero still renders nothing, matching the operator-promise line
 * above it — the brief deliberately does not spend attention on empty sections.
 * What must never be silent is a NON-measurement.
 */
export function renderVoicePromiseLine(
  state:
    | { kind: "unreadable" }
    | { kind: "error" }
    | { kind: "measured"; created: number; open: number; overdue: number },
): string {
  if (state.kind === "unreadable") {
    return "\nFROM CALLS (30d): couldn't read — state unknown, NOT zero."
      + " Voice-captured commitments may exist and are not shown here.";
  }
  if (state.kind === "error") {
    return "\nFROM CALLS (30d): read FAILED — state unknown, NOT zero.";
  }
  if (state.created === 0) return "";
  return `\nFROM CALLS (30d): ${state.created} callback commitments captured`
    + `${state.overdue > 0 ? ` · ${state.overdue} OVERDUE, nobody has closed these out` : ""}`
    + `${state.open > 0 ? ` · ${state.open} open` : ""}`
    + `\n  (kept isn't auto-detected for these — a counter callback is invisible to the system,`
    + ` so these are a to-do list, not a scorecard.)`;
}

export async function createVoicePromise(params: {
  promiseType: PromiseType;
  promisedAction: string;
  /** VAPI call id — the idempotency key and the audit trail. */
  vapiCallId: string;
  /** Derived, never invented. Null means "cannot promise a time". */
  dueAt: Date | null;
  customerName?: string | null;
  customerPhone?: string | null;
  owner?: string | null;
}): Promise<
  | { ok: true; id: string; created: true }
  | { ok: true; id: string; created: false; reason: "duplicate" }
  | { ok: false; skipped: true; reason: "no_due_time" | "no_call_id" }
  | { ok: false; error: string }
> {
  if (!params.vapiCallId) {
    // Without a call id there is no idempotency key, so a retry would
    // duplicate. Refuse rather than create an unauditable row.
    return { ok: false, skipped: true, reason: "no_call_id" };
  }
  if (!params.dueAt) {
    log.warn("voice promise skipped — no derivable due time", { vapiCallId: params.vapiCallId });
    return { ok: false, skipped: true, reason: "no_due_time" };
  }

  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };

  /**
   * The dedupe read, used TWICE: once to skip the insert, and once to resolve a
   * unique-key rejection into the row that beat us. One function rather than two
   * copies of the query — a second copy is free to drift from the index it is
   * supposed to mirror, and then the two disagree about what "duplicate" means.
   */
  const findExisting = async (): Promise<string | null> => {
    const existing = await db.execute(sql`
      SELECT id FROM customer_promises
      WHERE source_kind = 'voice'
        AND source_id = ${params.vapiCallId}
        AND promise_type = ${params.promiseType}
      LIMIT 1
    `);
    const found = rowsFromExecute(existing)[0] as { id?: unknown } | undefined;
    return found?.id ? String(found.id) : null;
  };

  try {
    const existingId = await findExisting();
    if (existingId) return { ok: true, id: existingId, created: false, reason: "duplicate" };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("create-voice");
      return { ok: false, error: "table not applied (migration 0102)" };
    }
    throw err;
  }

  try {
    const created = await createPromise({
      promiseType: params.promiseType,
      promisedAction: params.promisedAction,
      dueAt: params.dueAt,
      customerName: params.customerName ?? null,
      customerPhone: params.customerPhone ?? null,
      owner: params.owner ?? "Front Counter",
      sourceKind: "voice",
      sourceId: params.vapiCallId,
      createdBy: "voice-agent",
    });
    if (!created.ok) return created;
    return { ok: true, id: created.id, created: true };
  } catch (err) {
    // The window the read-then-write cannot close: a concurrent delivery
    // inserted between our SELECT and our INSERT, and uq_promise_source
    // rejected ours. That is the index doing its job, so the honest result is
    // the same one the pre-check would have returned a millisecond earlier.
    if (!isDuplicateKeyError(err)) throw err;
    const raced = await findExisting();
    if (raced) {
      log.info("voice promise deduped by unique index (concurrent delivery)", {
        vapiCallId: params.vapiCallId,
        promiseType: params.promiseType,
      });
      return { ok: true, id: raced, created: false, reason: "duplicate" };
    }
    // A duplicate-key error with no matching row is NOT our index — the id
    // primary key, or a constraint added later. Rethrowing is correct: this
    // catch exists to interpret one specific signal, not to swallow writes.
    throw err;
  }
}

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
      SELECT COUNT(*) AS n FROM customer_promises WHERE status = 'open'
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
 * Unmeasured is not failed. Voice promises are counted by voicePromiseBacklog()
 * and reported as a to-do list with that caveat attached.
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
