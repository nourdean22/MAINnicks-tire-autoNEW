/**
 * Revenue Opportunity Queue — REVENUE-OPS-ROADMAP Wave 4.
 *
 * ONE durable queue consolidating missed revenue opportunities from every
 * source system, replacing per-automation ad-hoc ledgers. The rules, from
 * the roadmap + the revenue-truth doctrine (docs/REVENUE-AUTOMATION-STATE.md):
 *
 *   - No recommendation without evidence (every row carries reason +
 *     evidence_json + data_quality).
 *   - No claimed action without a receipt (receipts_json is append-only
 *     audit history; transitions require who/when).
 *   - No revenue claim without a matched invoice (state `won` is ONLY
 *     reachable via recordOutcome() with a real invoice id — the roadmap's
 *     "measure recovery only from verified later outcomes").
 *   - Consent supremacy (smsOptOut → consent_ok=0; do_not_contact is
 *     terminal and reachable from any live state).
 *   - Dedup by (source_type, source_id) — collectors upsert; refreshes
 *     never touch state/owner/receipts.
 *   - This module NEVER contacts a customer. It reads sources and writes
 *     its own table. Outbound remains with the existing rails + operator.
 *
 * Table: revenue_opportunities (drizzle/0099, hand-applied via
 * scripts/migrations/apply-opportunity-queue.ts). Every read/write path
 * degrades gracefully when the table is absent (ROS-059 class: code must
 * not assume an unapplied migration) — collectors/readers return empty
 * and log a single warning per process.
 */

import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("opportunity-queue");

// ─── State machine (roadmap Wave-4 vocabulary, verbatim) ────────────

export const OPPORTUNITY_STATES = [
  "new",
  "assigned",
  "attempted",
  "contacted",
  "scheduled",
  "walk_in_expected",
  "arrived",
  "won",
  "lost",
  "no_response",
  "do_not_contact",
  "duplicate",
] as const;
export type OpportunityState = (typeof OPPORTUNITY_STATES)[number];

export const TERMINAL_STATES: readonly OpportunityState[] = [
  "won",
  "lost",
  "do_not_contact",
  "duplicate",
];

/**
 * Allowed forward transitions. `won` is deliberately ABSENT from every
 * list — it is only reachable through recordOutcome() with a verified
 * invoice. do_not_contact is reachable from every live state (consent
 * supremacy) and is added in canTransition rather than listed per-state.
 */
const TRANSITIONS: Record<OpportunityState, readonly OpportunityState[]> = {
  new: ["assigned", "attempted", "duplicate", "lost"],
  assigned: ["new", "attempted", "contacted", "duplicate", "lost"],
  attempted: ["attempted", "contacted", "no_response", "lost"],
  contacted: ["scheduled", "walk_in_expected", "no_response", "lost"],
  scheduled: ["walk_in_expected", "arrived", "no_response", "lost"],
  walk_in_expected: ["arrived", "no_response", "lost"],
  arrived: ["lost"], // won via recordOutcome only
  no_response: ["attempted", "lost"],
  won: [],
  lost: [],
  do_not_contact: [],
  duplicate: [],
};

export function canTransition(from: OpportunityState, to: OpportunityState): boolean {
  if (from === to && from === "attempted") return true; // re-attempt bumps the counter
  if (TERMINAL_STATES.includes(from)) return false;
  if (to === "do_not_contact") return true; // consent supremacy from any live state
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Transparent ranking ────────────────────────────────────────────
//
// score = expected dollars × urgency weight × data-quality weight,
// rounded. The FACTORS are returned alongside the score — the decisive
// inputs stay visible, no fake-precision composite. Weights are stated
// priors (triage ordering), not measured coefficients.

export type OpportunityUrgency = "critical" | "today" | "this_week" | "later";
export type OpportunityDataQuality = "verified" | "inferred" | "partial" | "unknown";

const URGENCY_WEIGHT: Record<OpportunityUrgency, number> = {
  critical: 3,
  today: 2,
  this_week: 1.5,
  later: 1,
};

const QUALITY_WEIGHT: Record<OpportunityDataQuality, number> = {
  verified: 1,
  inferred: 0.8,
  partial: 0.6,
  unknown: 0.5,
};

export function rankOpportunity(input: {
  expectedRevenueCents: number | null;
  urgency: OpportunityUrgency;
  dataQuality: OpportunityDataQuality;
}): { score: number; factors: { valueDollars: number; urgencyWeight: number; qualityWeight: number } } {
  const valueDollars = Math.round((input.expectedRevenueCents ?? 0) / 100);
  const urgencyWeight = URGENCY_WEIGHT[input.urgency] ?? 1;
  const qualityWeight = QUALITY_WEIGHT[input.dataQuality] ?? 0.5;
  return {
    score: Math.round(valueDollars * urgencyWeight * qualityWeight),
    factors: { valueDollars, urgencyWeight, qualityWeight },
  };
}

// ─── Row shape ──────────────────────────────────────────────────────

export interface OpportunityRow {
  id: string;
  sourceType: string;
  sourceId: string;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  expectedRevenueCents: number | null;
  dataQuality: OpportunityDataQuality;
  urgency: OpportunityUrgency;
  recommendedAction: string;
  reason: string;
  evidence: Record<string, unknown> | null;
  owner: string | null;
  dueAt: Date | null;
  state: OpportunityState;
  attempts: number;
  consentOk: boolean;
  receipts: Array<Record<string, unknown>>;
  outcomeInvoiceId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── DB plumbing with graceful degrade ──────────────────────────────

let tableMissingWarned = false;

function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /doesn'?t exist|ER_NO_SUCH_TABLE|1146/i.test(msg);
}

function warnMissingOnce(where: string): void {
  if (!tableMissingWarned) {
    tableMissingWarned = true;
    log.warn(
      `[opportunity-queue] revenue_opportunities table missing (${where}) — migration 0099 not applied yet. ` +
        `All queue reads return empty until scripts/migrations/apply-opportunity-queue.ts runs.`,
    );
  }
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function mapRow(r: Record<string, unknown>): OpportunityRow {
  return {
    id: String(r.id),
    sourceType: String(r.source_type),
    sourceId: String(r.source_id),
    customerId: r.customer_id == null ? null : Number(r.customer_id),
    customerName: r.customer_name == null ? null : String(r.customer_name),
    customerPhone: r.customer_phone == null ? null : String(r.customer_phone),
    expectedRevenueCents: r.expected_revenue_cents == null ? null : Number(r.expected_revenue_cents),
    dataQuality: String(r.data_quality) as OpportunityDataQuality,
    urgency: String(r.urgency) as OpportunityUrgency,
    recommendedAction: String(r.recommended_action),
    reason: String(r.reason),
    evidence: parseJsonField<Record<string, unknown> | null>(r.evidence_json, null),
    owner: r.owner == null ? null : String(r.owner),
    dueAt: r.due_at == null ? null : new Date(r.due_at as string),
    state: String(r.state) as OpportunityState,
    attempts: Number(r.attempts ?? 0),
    consentOk: Number(r.consent_ok ?? 1) === 1,
    receipts: parseJsonField<Array<Record<string, unknown>>>(r.receipts_json, []),
    outcomeInvoiceId: r.outcome_invoice_id == null ? null : Number(r.outcome_invoice_id),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
  };
}

function rowsFromExecute(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0] as Array<Record<string, unknown>>;
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  return [];
}

// ─── Upsert (collector write path) ──────────────────────────────────

export interface UpsertOpportunityInput {
  sourceType: string;
  sourceId: string;
  customerId?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  expectedRevenueCents?: number | null;
  dataQuality: OpportunityDataQuality;
  urgency: OpportunityUrgency;
  recommendedAction: string;
  reason: string;
  evidence?: Record<string, unknown> | null;
  consentOk?: boolean;
  dueAt?: Date | null;
}

/**
 * Queue-scoped contact policy (Strike-2). do_not_contact was
 * OPPORTUNITY-scoped: marking one row DNC did nothing to stop the next
 * collector run from creating a fresh consent-true row for the SAME
 * phone. Until a real customer-level contact-policy table exists, the
 * queue itself is the policy surface: any live-or-terminal
 * do_not_contact row for this phone (last-10 match) forces consent_ok=0
 * on every new/refreshed row for that phone.
 */
async function phoneHasQueueDnc(
  db: NonNullable<Awaited<ReturnType<(typeof import("../db"))["getDb"]>>>,
  phone: string,
): Promise<boolean> {
  const { sql } = await import("drizzle-orm");
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length !== 10) return false;
  const rows = rowsFromExecute(await db.execute(sql`
    SELECT id FROM revenue_opportunities
    WHERE state = 'do_not_contact'
      AND customer_phone IS NOT NULL
      AND RIGHT(REGEXP_REPLACE(customer_phone, '[^0-9]', ''), 10) = ${last10}
    LIMIT 1
  `));
  return rows.length > 0;
}

/**
 * Insert-or-refresh by (sourceType, sourceId). A refresh updates the
 * evidence/value/urgency/reason columns ONLY — state, owner, attempts,
 * receipts and outcome belong to the state machine and are never
 * touched here. Returns "inserted" | "refreshed" | "unavailable".
 */
export async function upsertOpportunity(
  input: UpsertOpportunityInput,
): Promise<"inserted" | "refreshed" | "unavailable"> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return "unavailable";

  try {
    // Strike-2 contact policy: a standing phone-level DNC (any
    // do_not_contact row for this phone) overrides whatever consent the
    // source would assign.
    if (input.consentOk !== false && input.customerPhone) {
      try {
        if (await phoneHasQueueDnc(db, input.customerPhone)) {
          input = { ...input, consentOk: false };
        }
      } catch {
        // policy lookup failure must not block the upsert; the row keeps
        // its source-derived consent and the next refresh retries
      }
    }
    const result = await db.execute(sql`
      INSERT INTO revenue_opportunities
        (id, source_type, source_id, customer_id, customer_name, customer_phone,
         expected_revenue_cents, data_quality, urgency, recommended_action,
         reason, evidence_json, consent_ok, due_at)
      VALUES
        (${randomUUID()}, ${input.sourceType}, ${input.sourceId},
         ${input.customerId ?? null}, ${input.customerName ?? null}, ${input.customerPhone ?? null},
         ${input.expectedRevenueCents ?? null}, ${input.dataQuality}, ${input.urgency},
         ${input.recommendedAction}, ${input.reason},
         ${input.evidence ? JSON.stringify(input.evidence) : null},
         ${input.consentOk === false ? 0 : 1}, ${input.dueAt ?? null})
      ON DUPLICATE KEY UPDATE
        expected_revenue_cents = VALUES(expected_revenue_cents),
        data_quality = VALUES(data_quality),
        urgency = VALUES(urgency),
        recommended_action = VALUES(recommended_action),
        reason = VALUES(reason),
        evidence_json = VALUES(evidence_json),
        consent_ok = VALUES(consent_ok),
        updated_at = CURRENT_TIMESTAMP
    `);
    const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object"
      ? result[0]
      : result) as { affectedRows?: number };
    // mysql2 reports affectedRows 1 for insert, 2 for duplicate-update.
    return (raw.affectedRows ?? 1) >= 2 ? "refreshed" : "inserted";
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("upsert");
      return "unavailable";
    }
    throw err;
  }
}

// ─── Reads ──────────────────────────────────────────────────────────

export async function listOpportunities(opts?: {
  states?: OpportunityState[];
  limit?: number;
}): Promise<OpportunityRow[]> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return [];

  const limit = Math.min(opts?.limit ?? 100, 500);
  const states = opts?.states?.length ? opts.states : null;
  try {
    const result = states
      ? await db.execute(sql`
          SELECT * FROM revenue_opportunities
          WHERE state IN (${sql.join(states.map((s) => sql`${s}`), sql`, `)})
          ORDER BY updated_at DESC LIMIT ${limit}
        `)
      : await db.execute(sql`
          SELECT * FROM revenue_opportunities ORDER BY updated_at DESC LIMIT ${limit}
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

export interface RankedDecision extends OpportunityRow {
  score: number;
  factors: { valueDollars: number; urgencyWeight: number; qualityWeight: number };
}

const LIVE_STATES: readonly OpportunityState[] = [
  "new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "no_response",
];

/**
 * The owner's top-N decisions: live, consented, DUE, ranked in SQL over
 * the FULL eligible set. Strike-2 fixes two review P1s here:
 *   - due-aware: a snoozed row (due_at in the future) is EXCLUDED and
 *     counted, so Snooze actually hides the item until its time —
 *     pre-fix, snooze wrote due_at and nothing read it.
 *   - full-set ranking: selection previously ranked a 200-row
 *     `updated_at DESC` subset, so which rows even competed depended on
 *     collector refresh order. The ORDER BY below mirrors
 *     rankOpportunity's semantics (urgency primary, then quality-
 *     weighted value, oldest first on ties) as a deterministic SQL sort.
 * Excluded rows are counted, never silent.
 */
export async function topDecisions(n = 5): Promise<{
  decisions: RankedDecision[];
  excludedNoConsent: number;
  excludedSnoozed: number;
  totalLive: number;
}> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { decisions: [], excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 0 };

  const stateList = sql.join(LIVE_STATES.map((s) => sql`${s}`), sql`, `);
  try {
    const countRows = rowsFromExecute(await db.execute(sql`
      SELECT COUNT(*) AS totalLive,
             SUM(consent_ok = 0) AS noConsent,
             SUM(consent_ok = 1 AND due_at IS NOT NULL AND due_at > NOW()) AS snoozed
      FROM revenue_opportunities
      WHERE state IN (${stateList})
    `));
    const counts = countRows[0] ?? {};

    const ranked = rowsFromExecute(await db.execute(sql`
      SELECT * FROM revenue_opportunities
      WHERE state IN (${stateList})
        AND consent_ok = 1
        AND (due_at IS NULL OR due_at <= NOW())
      ORDER BY
        CASE urgency WHEN 'critical' THEN 4 WHEN 'today' THEN 3 WHEN 'this_week' THEN 2 ELSE 1 END DESC,
        CASE data_quality WHEN 'verified' THEN 4 WHEN 'inferred' THEN 3 WHEN 'partial' THEN 2 ELSE 1 END
          * COALESCE(expected_revenue_cents, 0) DESC,
        created_at ASC
      LIMIT ${n}
    `)).map(mapRow);

    const decisions = ranked.map((o) => ({
      ...o,
      ...rankOpportunity({
        expectedRevenueCents: o.expectedRevenueCents,
        urgency: o.urgency,
        dataQuality: o.dataQuality,
      }),
    }));
    return {
      decisions,
      excludedNoConsent: Number(counts.noConsent ?? 0),
      excludedSnoozed: Number(counts.snoozed ?? 0),
      totalLive: Number(counts.totalLive ?? 0),
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("topDecisions");
      return { decisions: [], excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 0 };
    }
    throw err;
  }
}

// ─── State machine (write path) ─────────────────────────────────────

/**
 * Transition an opportunity. Optimistic + atomic: the UPDATE carries
 * `WHERE id = ? AND state = <expected>` so a concurrent transition makes
 * this one affect 0 rows and surface as a conflict instead of silently
 * clobbering. Every successful transition appends a receipt.
 */
export async function transitionOpportunity(params: {
  id: string;
  to: OpportunityState;
  by: string;
  note?: string;
  owner?: string | null;
  dueAt?: Date | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };

  if (params.to === "won") {
    return { ok: false, error: "won is only reachable via recordOutcome with a verified invoice id" };
  }

  try {
    const rows = rowsFromExecute(
      await db.execute(sql`SELECT * FROM revenue_opportunities WHERE id = ${params.id} LIMIT 1`),
    );
    if (rows.length === 0) return { ok: false, error: "not found" };
    const current = mapRow(rows[0]);

    if (!canTransition(current.state, params.to)) {
      return { ok: false, error: `illegal transition ${current.state} -> ${params.to}` };
    }

    const receipt = {
      at: new Date().toISOString(),
      by: params.by,
      from: current.state,
      to: params.to,
      ...(params.note ? { note: params.note } : {}),
    };
    const receipts = [...current.receipts, receipt];
    const attemptsBump = params.to === "attempted" ? 1 : 0;

    const result = await db.execute(sql`
      UPDATE revenue_opportunities
      SET state = ${params.to},
          receipts_json = ${JSON.stringify(receipts)},
          attempts = attempts + ${attemptsBump},
          owner = ${params.owner !== undefined ? params.owner : current.owner},
          due_at = ${params.dueAt !== undefined ? params.dueAt : current.dueAt},
          consent_ok = ${params.to === "do_not_contact" ? 0 : (current.consentOk ? 1 : 0)},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${params.id} AND state = ${current.state}
    `);
    const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object"
      ? result[0]
      : result) as { affectedRows?: number };
    if ((raw.affectedRows ?? 0) === 0) {
      return { ok: false, error: "conflict: state changed concurrently — re-read and retry" };
    }

    // Strike-2 contact policy: DNC is phone-scoped, not row-scoped. Zero
    // consent on every OTHER live row for the same phone so the inbox
    // never recommends contacting a number the operator just marked DNC
    // (collectors also honor this via phoneHasQueueDnc on upsert).
    if (params.to === "do_not_contact" && current.customerPhone) {
      const last10 = current.customerPhone.replace(/\D/g, "").slice(-10);
      if (last10.length === 10) {
        try {
          await db.execute(sql`
            UPDATE revenue_opportunities
            SET consent_ok = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id != ${params.id}
              AND customer_phone IS NOT NULL
              AND RIGHT(REGEXP_REPLACE(customer_phone, '[^0-9]', ''), 10) = ${last10}
              AND state IN (${sql.join(LIVE_STATES.map((s) => sql`${s}`), sql`, `)})
          `);
        } catch (sweepErr) {
          log.warn("[opportunity-queue] phone-wide DNC sweep failed (row itself IS marked)", {
            error: sweepErr instanceof Error ? sweepErr.message : String(sweepErr),
          });
        }
      }
    }
    return { ok: true };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("transition");
      return { ok: false, error: "table not applied (migration 0099)" };
    }
    throw err;
  }
}

/**
 * Snooze: push due_at without a state change (snooze is scheduling, not
 * a state — the roadmap vocabulary has no "snoozed"). Appends a receipt
 * so the audit trail shows who deferred it and until when.
 */
export async function snoozeOpportunity(params: {
  id: string;
  untilISO: string;
  by: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };

  try {
    const rows = rowsFromExecute(
      await db.execute(sql`SELECT * FROM revenue_opportunities WHERE id = ${params.id} LIMIT 1`),
    );
    if (rows.length === 0) return { ok: false, error: "not found" };
    const current = mapRow(rows[0]);
    if (TERMINAL_STATES.includes(current.state)) {
      return { ok: false, error: `already terminal (${current.state})` };
    }
    const receipt = {
      at: new Date().toISOString(),
      by: params.by,
      snoozedUntil: params.untilISO,
    };
    const receipts = [...current.receipts, receipt];
    await db.execute(sql`
      UPDATE revenue_opportunities
      SET due_at = ${new Date(params.untilISO)},
          receipts_json = ${JSON.stringify(receipts)},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${params.id}
    `);
    return { ok: true };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("snooze");
      return { ok: false, error: "table not applied (migration 0099)" };
    }
    throw err;
  }
}

/**
 * Pure outcome-match classifier (Strike-2, exported for tests).
 * Pre-fix, `won` verified only that SOME invoice with that id existed —
 * any invoice could be attached to any opportunity and counted as
 * verified recovered revenue. Match tiers:
 *   direct — the SOURCE carries the linkage (alg_estimates.
 *            matched_invoice_id equals this invoice).
 *   strong — same normalized phone AND the invoice is dated on/after
 *            the opportunity (1-day slack for same-day timing).
 *   manual — operator explicitly attached it (allowManualMatch); stored
 *            as manual, never counted as independently verified.
 *   rejected — nothing links them; the win is refused.
 */
export function classifyOutcomeMatch(input: {
  opportunityPhone: string | null;
  opportunityCreatedAt: Date;
  invoicePhone: string | null;
  invoiceDate: Date | null;
  sourceLinkedInvoiceId: number | null;
  invoiceId: number;
  allowManualMatch: boolean;
}): { method: "direct" | "strong" | "manual"; detail: string } | { method: "rejected"; detail: string } {
  if (input.sourceLinkedInvoiceId != null && input.sourceLinkedInvoiceId === input.invoiceId) {
    return { method: "direct", detail: "source row links this exact invoice" };
  }
  const oppLast10 = (input.opportunityPhone ?? "").replace(/\D/g, "").slice(-10);
  const invLast10 = (input.invoicePhone ?? "").replace(/\D/g, "").slice(-10);
  const phoneMatches = oppLast10.length === 10 && oppLast10 === invLast10;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dateOk =
    input.invoiceDate != null &&
    input.invoiceDate.getTime() >= input.opportunityCreatedAt.getTime() - DAY_MS;
  if (phoneMatches && dateOk) {
    return { method: "strong", detail: "phone matches and invoice postdates the opportunity" };
  }
  if (input.allowManualMatch) {
    return {
      method: "manual",
      detail: `operator-attached without independent linkage (phoneMatch=${phoneMatches}, dateOk=${dateOk})`,
    };
  }
  const why = !phoneMatches
    ? "invoice phone does not match the opportunity"
    : "invoice predates the opportunity";
  return { method: "rejected", detail: why };
}

/**
 * The ONLY path to `won`. Requires a real invoice AND a defensible link
 * between that invoice and THIS opportunity (classifyOutcomeMatch).
 * Roadmap: "measure recovery only from verified later outcomes."
 */
export async function recordOutcome(params: {
  id: string;
  invoiceId: number;
  by: string;
  /** Operator override: record the win as an explicit MANUAL match. */
  allowManualMatch?: boolean;
}): Promise<{ ok: true; matchMethod: "direct" | "strong" | "manual" } | { ok: false; error: string }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };

  try {
    const invoiceRows = rowsFromExecute(
      await db.execute(sql`
        SELECT id, customerPhone, invoiceDate FROM invoices WHERE id = ${params.invoiceId} LIMIT 1
      `),
    );
    if (invoiceRows.length === 0) {
      return { ok: false, error: `invoice ${params.invoiceId} not found — won requires a verified invoice` };
    }
    const invoice = invoiceRows[0] as { customerPhone?: string | null; invoiceDate?: string | Date | null };

    const rows = rowsFromExecute(
      await db.execute(sql`SELECT * FROM revenue_opportunities WHERE id = ${params.id} LIMIT 1`),
    );
    if (rows.length === 0) return { ok: false, error: "not found" };
    const current = mapRow(rows[0]);
    if (TERMINAL_STATES.includes(current.state)) {
      return { ok: false, error: `already terminal (${current.state})` };
    }

    // Direct linkage: for estimate-sourced opportunities the source row
    // itself may already carry the matched invoice.
    let sourceLinkedInvoiceId: number | null = null;
    const estimateId = (current.evidence as Record<string, unknown> | null)?.estimateId;
    if (current.sourceType === "unapproved_estimate" && typeof estimateId === "number") {
      try {
        const linkRows = rowsFromExecute(await db.execute(sql`
          SELECT matched_invoice_id AS linked FROM alg_estimates WHERE id = ${estimateId} LIMIT 1
        `));
        const linked = linkRows[0]?.linked;
        sourceLinkedInvoiceId = linked == null ? null : Number(linked);
      } catch {
        // linkage lookup is best-effort; phone+date can still qualify
      }
    }

    const match = classifyOutcomeMatch({
      opportunityPhone: current.customerPhone,
      opportunityCreatedAt: current.createdAt,
      invoicePhone: invoice.customerPhone == null ? null : String(invoice.customerPhone),
      invoiceDate: invoice.invoiceDate == null ? null : new Date(invoice.invoiceDate),
      sourceLinkedInvoiceId,
      invoiceId: params.invoiceId,
      allowManualMatch: params.allowManualMatch === true,
    });
    if (match.method === "rejected") {
      return {
        ok: false,
        error: `invoice ${params.invoiceId} does not match this opportunity (${match.detail}) — pass allowManualMatch to attach it as an explicit manual match`,
      };
    }

    const receipt = {
      at: new Date().toISOString(),
      by: params.by,
      from: current.state,
      to: "won",
      invoiceId: params.invoiceId,
      matchMethod: match.method,
      matchDetail: match.detail,
    };
    const receipts = [...current.receipts, receipt];

    const result = await db.execute(sql`
      UPDATE revenue_opportunities
      SET state = 'won',
          receipts_json = ${JSON.stringify(receipts)},
          outcome_invoice_id = ${params.invoiceId},
          outcome_verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${params.id} AND state = ${current.state}
    `);
    const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object"
      ? result[0]
      : result) as { affectedRows?: number };
    if ((raw.affectedRows ?? 0) === 0) {
      return { ok: false, error: "conflict: state changed concurrently — re-read and retry" };
    }
    return { ok: true, matchMethod: match.method };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("recordOutcome");
      return { ok: false, error: "table not applied (migration 0099)" };
    }
    throw err;
  }
}

// ─── Collectors (read sources → upsert queue · NEVER contact anyone) ─

/**
 * Honest collector telemetry (Strike-2). Pre-fix every collector
 * reported one `upserted` count that incremented on refreshes too, so a
 * cron re-touching the same unresolved rows read as "productive" every
 * run — the exact loop-shape defect the loopShapeContract was built to
 * catch. `inserted` = genuinely new rows; `refreshed` = existing rows
 * re-touched.
 */
export interface CollectorStats {
  scanned: number;
  inserted: number;
  refreshed: number;
}

/**
 * Pure identity resolver for the last-10 phone join (Strike-2, exported
 * for tests). The SMS path already learned this rule the hard way:
 *   0 matches  → unknown customer (no linkage)
 *   1 match    → linked
 *   2+ matches → AMBIGUOUS: no customer linkage, and if ANY candidate
 *                opted out, SMS-class consent is refused (a shared or
 *                recycled number must never inherit the wrong person's
 *                consent).
 */
export function resolveEstimateIdentity(input: {
  matchCount: number;
  anyCustomerId: number | null;
  anyOptOut: boolean;
}): { customerId: number | null; consentOk: boolean; ambiguous: boolean } {
  if (input.matchCount <= 0) return { customerId: null, consentOk: true, ambiguous: false };
  if (input.matchCount === 1) {
    return { customerId: input.anyCustomerId, consentOk: !input.anyOptOut, ambiguous: false };
  }
  return { customerId: null, consentOk: !input.anyOptOut, ambiguous: true };
}

/**
 * Unresolved ALG estimates (7-60d old, ≥ $150) → unapproved_estimate
 * opportunities. data_quality is "inferred" BY DESIGN: an unmatched
 * estimate is unresolved, not proven-declined (revenue-truth doctrine).
 * Identity: the bare last-10 LEFT JOIN multiplied rows when a phone
 * matched 2+ customers (last write won, consent read off a possibly
 * wrong person). Now aggregated per estimate and resolved through
 * resolveEstimateIdentity's ambiguity rules.
 */
export async function collectUnapprovedEstimates(): Promise<CollectorStats> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0 };

  const MIN_CENTS = 15_000; // below $150 it's not an owner-level decision
  let rows: Array<Record<string, unknown>>;
  // Identity join aggregated per estimate (GROUP BY the alg_estimates PK)
  // so a phone shared by 2+ customer rows can no longer multiply the
  // estimate into several conflicting upserts. matchCount drives the
  // ambiguity rule; anyOptOut is the CONSERVATIVE consent read (if any
  // candidate opted out, SMS-class consent is refused).
  const query = (withConcern: boolean) => sql`
      SELECT e.id, e.customer_name AS customerName, e.customer_phone AS customerPhone,
             e.service_description AS serviceDescription, e.estimated_amount AS estimatedAmount,
             e.estimate_date AS estimateDate,
             e.follow_up_7d_sent AS f7, e.follow_up_30d_sent AS f30,
             ${withConcern ? sql`e.stated_concern` : sql`NULL`} AS statedConcern,
             COUNT(DISTINCT c.id) AS matchCount,
             MIN(c.id) AS anyCustomerId,
             MAX(CASE WHEN c.smsOptOut = 1 THEN 1 ELSE 0 END) AS anyOptOut
      FROM alg_estimates e
      LEFT JOIN customers c
        ON RIGHT(REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', ''), 10)
         = RIGHT(REGEXP_REPLACE(COALESCE(e.customer_phone, ''), '[^0-9]', ''), 10)
       AND e.customer_phone IS NOT NULL
      WHERE e.matched_invoice_id IS NULL
        AND e.estimate_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
        AND e.estimate_date <= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND e.estimated_amount >= ${MIN_CENTS}
        ${withConcern ? sql`AND (e.stated_concern IS NULL OR e.stated_concern NOT IN ('repaired_elsewhere', 'no_longer_owns', 'not_interested'))` : sql``}
      GROUP BY e.id
      LIMIT 300
    `;
  try {
    // stated_concern (0100): closed signals (repaired elsewhere / sold /
    // not interested) are excluded — the customer answered; there is no
    // decision left to surface. Pre-0100 environments fall back to the
    // same query without the column.
    rows = rowsFromExecute(await db.execute(query(true)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unknown column|1054/i.test(msg)) {
      try {
        rows = rowsFromExecute(await db.execute(query(false)));
      } catch (retryErr) {
        log.warn("[opportunity-queue] estimate collector query failed", {
          error: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
        return { scanned: 0, inserted: 0, refreshed: 0 };
      }
    } else {
      log.warn("[opportunity-queue] estimate collector query failed", {
        error: msg,
      });
      return { scanned: 0, inserted: 0, refreshed: 0 };
    }
  }

  let inserted = 0;
  let refreshed = 0;
  for (const r of rows) {
    const amountCents = Number(r.estimatedAmount ?? 0);
    const ageDays = r.estimateDate
      ? Math.floor((Date.now() - new Date(r.estimateDate as string).getTime()) / 86_400_000)
      : 0;
    const touches = (Number(r.f7 ?? 0) ? 1 : 0) + (Number(r.f30 ?? 0) ? 1 : 0);
    const name = r.customerName ? String(r.customerName) : "customer";
    const service = r.serviceDescription ? String(r.serviceDescription).slice(0, 80) : "quoted work";
    const identity = resolveEstimateIdentity({
      matchCount: Number(r.matchCount ?? 0),
      anyCustomerId: r.anyCustomerId == null ? null : Number(r.anyCustomerId),
      anyOptOut: Number(r.anyOptOut ?? 0) === 1,
    });
    const res = await upsertOpportunity({
      sourceType: "unapproved_estimate",
      sourceId: String(r.id),
      customerId: identity.customerId,
      customerName: name,
      customerPhone: r.customerPhone == null ? null : String(r.customerPhone),
      expectedRevenueCents: amountCents,
      dataQuality: "inferred",
      urgency: amountCents >= 80_000 ? "today" : "this_week",
      recommendedAction: `Call ${name} about the $${Math.round(amountCents / 100)} ${service} quote`,
      reason: `Estimate ${ageDays}d old with no matched invoice (unresolved — not proven declined). Recovery SMS touches so far: ${touches}.`,
      evidence: {
        estimateId: Number(r.id),
        estimateAgeDays: ageDays,
        serviceDescription: service,
        recoveryTouchesSent: touches,
        statedConcern: r.statedConcern ? String(r.statedConcern) : null,
        ...(identity.ambiguous
          ? { identityAmbiguous: true, identityMatches: Number(r.matchCount ?? 0) }
          : {}),
      },
      consentOk: identity.consentOk,
    });
    if (res === "inserted") inserted++;
    else if (res === "refreshed") refreshed++;
    else return { scanned: rows.length, inserted, refreshed }; // table missing — stop early
  }
  return { scanned: rows.length, inserted, refreshed };
}

/**
 * Pending callback requests → callback opportunities. data_quality is
 * "verified" (the customer explicitly asked to be called) and urgency
 * critical — this is the highest-signal row the queue can hold.
 */
export async function collectPendingCallbacks(): Promise<CollectorStats> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0 };

  let rows: Array<Record<string, unknown>>;
  try {
    rows = rowsFromExecute(await db.execute(sql`
      SELECT id, name, phone, context, createdAt
      FROM callback_requests
      WHERE status = 'new'
      ORDER BY createdAt ASC
      LIMIT 100
    `));
  } catch (err) {
    log.warn("[opportunity-queue] callback collector query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, inserted: 0, refreshed: 0 };
  }

  let inserted = 0;
  let refreshed = 0;
  for (const r of rows) {
    const name = r.name ? String(r.name) : "customer";
    const ageHours = r.createdAt
      ? Math.round((Date.now() - new Date(r.createdAt as string).getTime()) / 3_600_000)
      : 0;
    const res = await upsertOpportunity({
      sourceType: "callback",
      sourceId: String(r.id),
      customerName: name,
      customerPhone: r.phone == null ? null : String(r.phone),
      expectedRevenueCents: null, // unknown until spoken to — never invent
      dataQuality: "verified",
      urgency: "critical",
      recommendedAction: `Call ${name} back — they asked for a call${r.context ? ` about: ${String(r.context).slice(0, 60)}` : ""}`,
      reason: `Customer explicitly requested a callback ${ageHours}h ago and hasn't been called.`,
      evidence: {
        callbackId: Number(r.id),
        requestedAgoHours: ageHours,
        context: r.context ? String(r.context).slice(0, 200) : null,
      },
      consentOk: true, // they asked to be contacted
    });
    if (res === "inserted") inserted++;
    else if (res === "refreshed") refreshed++;
    else return { scanned: rows.length, inserted, refreshed };
  }
  return { scanned: rows.length, inserted, refreshed };
}

/**
 * Unconverted VAPI calls → missed_call opportunities. Reuses the missed-
 * call cron's OWN pure eligibility predicate (isMissedCallEligible) so
 * the queue and the SMS shadow can never disagree about who counts.
 * data_quality "verified" (the customer really called), urgency "today"
 * (a missed caller cools by the hour). The recommended action is a HUMAN
 * CALL BACK — consent gates for SMS don't apply to returning a call, so
 * consentOk stays true. Never sends anything.
 */
export async function collectMissedCalls(): Promise<CollectorStats> {
  const { getDbTyped } = await import("../db");
  const db = await getDbTyped();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0 };

  const { vapiCallLogs } = await import("../../drizzle/schema");
  const { and, eq, gte, lte, isNull, isNotNull, desc } = await import("drizzle-orm");
  const { isMissedCallEligible } = await import("../cron/jobs/missedCallRecovery");

  const now = Date.now();
  const windowStart = new Date(now - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now - 45 * 60 * 1000);

  let rows: Array<{
    id: number; vapiCallId: string; phoneNumber: string | null; durationSeconds: number;
    convertedToLead: number; leadId: number | null; callbackId: number | null;
    metadata: unknown; createdAt: Date;
  }>;
  try {
    rows = await db.select({
      id: vapiCallLogs.id,
      vapiCallId: vapiCallLogs.vapiCallId,
      phoneNumber: vapiCallLogs.phoneNumber,
      durationSeconds: vapiCallLogs.durationSeconds,
      convertedToLead: vapiCallLogs.convertedToLead,
      leadId: vapiCallLogs.leadId,
      callbackId: vapiCallLogs.callbackId,
      metadata: vapiCallLogs.metadata,
      createdAt: vapiCallLogs.createdAt,
    })
      .from(vapiCallLogs)
      .where(and(
        eq(vapiCallLogs.convertedToLead, 0),
        isNotNull(vapiCallLogs.phoneNumber),
        isNull(vapiCallLogs.leadId),
        isNull(vapiCallLogs.callbackId),
        gte(vapiCallLogs.createdAt, windowStart),
        lte(vapiCallLogs.createdAt, windowEnd),
      ))
      .orderBy(desc(vapiCallLogs.createdAt))
      .limit(100);
  } catch (err) {
    log.warn("[opportunity-queue] missed-call collector query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, inserted: 0, refreshed: 0 };
  }

  let inserted = 0;
  let refreshed = 0;
  for (const r of rows) {
    const meta = (r.metadata ?? null) as Record<string, unknown> | null;
    const eligible = isMissedCallEligible({
      id: r.id,
      vapiCallId: r.vapiCallId,
      phoneNumber: r.phoneNumber,
      durationSeconds: r.durationSeconds,
      convertedToLead: r.convertedToLead,
      leadId: r.leadId,
      callbackId: r.callbackId,
      recoveryAlreadyStamped: false, // recovery SMS state doesn't gate a human call-back
      createdAtMs: new Date(r.createdAt).getTime(),
    }, now);
    if (!eligible) continue;

    const ageMin = Math.round((now - new Date(r.createdAt).getTime()) / 60_000);
    const res = await upsertOpportunity({
      sourceType: "missed_call",
      sourceId: r.vapiCallId,
      customerPhone: r.phoneNumber,
      expectedRevenueCents: null, // unknown until spoken to — never invent
      dataQuality: "verified",
      urgency: "today",
      recommendedAction: `Call back ${r.phoneNumber} — ${r.durationSeconds}s call ${ageMin}min ago, no lead or callback captured`,
      reason: `Real conversation (${r.durationSeconds}s ≥ 15s) on the VAPI line that converted to nothing. A human call-back beats any text.`,
      evidence: {
        vapiCallId: r.vapiCallId,
        durationSeconds: r.durationSeconds,
        callAgeMinutes: ageMin,
      },
      consentOk: true, // returning a phone call the customer made
    });
    if (res === "inserted") inserted++;
    else if (res === "refreshed") refreshed++;
    else return { scanned: rows.length, inserted, refreshed };
  }
  return { scanned: rows.length, inserted, refreshed };
}

/**
 * Inbound-SMS complaint → review_recovery opportunity (the receive side
 * of the plan's service-recovery loop). Uses the intent router's PURE
 * classifier with a no-state context — complaint language is detectable
 * without booking state; the orchestrator still does the full-context
 * version for the actual reply. One opportunity per phone per day
 * (sourceId = phone10:YYYY-MM-DD) so a heated thread doesn't spam the
 * inbox. NEVER sends anything; the review-request engine is untouched
 * and review asks are never conditioned on this (no gating).
 */
export async function captureComplaintOpportunity(
  phone: string,
  body: string,
): Promise<{ captured: boolean }> {
  try {
    const { routeInboundSms } = await import("./smsIntentRouter");
    const decision = routeInboundSms(body, {
      hasActiveBooking: false,
      hasActiveEstimate: false,
      hasActiveLead: false,
    });
    const isComplaint =
      decision.primary === "complaint_or_comeback" ||
      decision.secondary.includes("complaint_or_comeback");
    if (!isComplaint) return { captured: false };

    const phone10 = phone.replace(/\D/g, "").slice(-10);
    if (phone10.length !== 10) return { captured: false };
    const dayKey = new Date().toISOString().slice(0, 10);

    const res = await upsertOpportunity({
      sourceType: "review_recovery",
      sourceId: `${phone10}:${dayKey}`,
      customerPhone: phone,
      expectedRevenueCents: null,
      dataQuality: "verified",
      urgency: "critical",
      recommendedAction: `Call ${phone} — customer reported a problem after service`,
      reason: `Inbound SMS classified complaint_or_comeback: "${body.slice(0, 120)}"`,
      evidence: {
        messageExcerpt: body.slice(0, 200),
        routerSignals: decision.signals,
      },
      consentOk: true, // they texted us about a problem; the action is a call
    });
    return { captured: res !== "unavailable" };
  } catch (err) {
    log.warn("[opportunity-queue] complaint capture failed (fail-open)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { captured: false };
  }
}

/**
 * Pure DVI-deferral summarizer — exported for tests. Given an
 * inspection's items, returns what the queue should know: which
 * yellow/red items are still open (no decision, or declined), the
 * red count, and the summed tech estimate. `question` items are NOT
 * "open deferrals" — a question is an engagement, handled by the
 * operator conversation, not a deferral chase.
 */
export function summarizeInspectionForQueue(
  items: Array<{ condition: string; decision: string | null; estimatedCost: number | null; photoUrl?: string | null }>,
): { openFlagged: number; redOpen: number; valueCents: number; urgency: OpportunityUrgency; photoSupportedOpen: number } {
  const open = items.filter(
    (i) =>
      (i.condition === "red" || i.condition === "yellow") &&
      (i.decision === null || i.decision === "declined"),
  );
  const redOpen = open.filter((i) => i.condition === "red").length;
  // estimatedCost is stored in DOLLARS on inspection_items
  const valueCents = open.reduce((s, i) => s + (i.estimatedCost ?? 0) * 100, 0);
  // Strike-3 evidence classes: a typed-only finding is a technician
  // ASSERTION; a photo makes it photo-supported. The distinction drives
  // data_quality below — "verified" was previously claimed for every
  // finding regardless of whether any evidence beyond free text existed.
  const photoSupportedOpen = open.filter((i) => !!i.photoUrl).length;
  return {
    openFlagged: open.length,
    redOpen,
    valueCents,
    urgency: redOpen > 0 ? "today" : "this_week",
    photoSupportedOpen,
  };
}

/**
 * Published DVI packets with open yellow/red items → deferred_service
 * opportunities (one per inspection, value = summed tech estimates,
 * red items force urgency "today"). data_quality "verified" — a
 * technician physically saw the component; this is the strongest
 * evidence class the queue holds. Pre-0101 environments degrade
 * gracefully (decision column absent → treated as all-open).
 */
export async function collectInspectionDeferrals(): Promise<CollectorStats> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0 };

  type Row = {
    inspectionId: number; customerName: string; customerPhone: string | null;
    vehicleInfo: string; publishedAgeDays: number; unlinked: number;
    condition: string; decision: string | null; estimatedCost: number | null;
    photoUrl: string | null;
  };
  let rows: Row[];
  const baseQuery = (withDecision: boolean) => sql`
    SELECT v.id AS inspectionId, v.customerName AS customerName,
           v.customerPhone AS customerPhone, v.vehicleInfo AS vehicleInfo,
           DATEDIFF(NOW(), v.createdAt) AS publishedAgeDays,
           (v.bookingId IS NULL) AS unlinked,
           i.condition AS condition,
           ${withDecision ? sql`i.decision` : sql`NULL`} AS decision,
           i.estimatedCost AS estimatedCost,
           i.photoUrl AS photoUrl
    FROM vehicle_inspections v
    INNER JOIN inspection_items i ON i.inspectionId = v.id
    WHERE v.isPublished = 1
      AND v.createdAt >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      AND i.condition IN ('red', 'yellow')
  `;
  try {
    rows = rowsFromExecute(await db.execute(baseQuery(true))) as unknown as Row[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unknown column|1054/i.test(msg)) {
      try {
        rows = rowsFromExecute(await db.execute(baseQuery(false))) as unknown as Row[];
      } catch {
        return { scanned: 0, inserted: 0, refreshed: 0 };
      }
    } else {
      log.warn("[opportunity-queue] inspection collector query failed", { error: msg });
      return { scanned: 0, inserted: 0, refreshed: 0 };
    }
  }

  // Group items per inspection, summarize with the pure helper.
  const byInspection = new Map<number, { meta: Row; items: Row[] }>();
  for (const r of rows) {
    const entry = byInspection.get(Number(r.inspectionId)) ?? { meta: r, items: [] };
    entry.items.push(r);
    byInspection.set(Number(r.inspectionId), entry);
  }

  let inserted = 0;
  let refreshed = 0;
  for (const { meta, items } of byInspection.values()) {
    const s = summarizeInspectionForQueue(
      items.map((i) => ({
        condition: String(i.condition),
        decision: i.decision == null ? null : String(i.decision),
        estimatedCost: i.estimatedCost == null ? null : Number(i.estimatedCost),
        photoUrl: i.photoUrl == null ? null : String(i.photoUrl),
      })),
    );
    if (s.openFlagged === 0) continue; // everything approved/answered — no deferral

    const res = await upsertOpportunity({
      sourceType: "deferred_service",
      sourceId: `inspection:${meta.inspectionId}`,
      customerName: meta.customerName,
      customerPhone: meta.customerPhone,
      expectedRevenueCents: s.valueCents > 0 ? s.valueCents : null,
      // Strike-3 evidence honesty: "verified" requires at least one OPEN
      // flagged item with a photo. Typed-only findings are a technician
      // assertion — real, but a weaker evidence class, so "inferred".
      dataQuality: s.photoSupportedOpen > 0 ? "verified" : "inferred",
      urgency: s.urgency,
      recommendedAction: `Call ${meta.customerName} — ${s.openFlagged} flagged ${s.openFlagged === 1 ? "item" : "items"} on the ${meta.vehicleInfo} check${s.redOpen > 0 ? ` (${s.redOpen} urgent)` : ""}`,
      reason: `Published vehicle check (${Number(meta.publishedAgeDays)}d ago) has ${s.openFlagged} yellow/red ${s.openFlagged === 1 ? "item" : "items"} with no approval — tech-verified findings, customer undecided or passed.`,
      evidence: {
        inspectionId: Number(meta.inspectionId),
        openFlaggedItems: s.openFlagged,
        redOpen: s.redOpen,
        publishedAgeDays: Number(meta.publishedAgeDays),
        evidenceClass: s.photoSupportedOpen > 0 ? "photo_supported" : "technician_asserted",
        photoSupportedItems: s.photoSupportedOpen,
        // Strike-3: a packet created stand-alone (no booking linkage) is
        // visibly labeled — identity drift and outcome measurement both
        // depend on knowing which packets tie to a real shop job.
        linkedToBooking: Number(meta.unlinked) !== 1,
      },
      consentOk: true, // follow-up call about their own vehicle's check
    });
    if (res === "inserted") inserted++;
    else if (res === "refreshed") refreshed++;
    else return { scanned: byInspection.size, inserted, refreshed };
  }
  return { scanned: byInspection.size, inserted, refreshed };
}

// ─── Source reconcilers (Strike-2) ──────────────────────────────────
//
// A queue that only ever ADDS rows drifts into a wall of stale asks:
// the estimate got paid, the callback was handled, the missed call aged
// out — and the inbox still says "call them". Each reconciler closes
// live rows whose SOURCE has resolved. Closures use the roadmap's own
// vocabulary: a source-linked invoice → won via recordOutcome (direct
// match); everything else → `lost` with a receipt naming the REAL
// reason (the state machine has no "resolved" state by design — the
// receipt, not the coarse state, carries the truth).

export interface ReconcileStats {
  checked: number;
  won: number;
  closed: number;
}

export async function reconcileOpportunities(): Promise<ReconcileStats> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { checked: 0, won: 0, closed: 0 };

  const stats: ReconcileStats = { checked: 0, won: 0, closed: 0 };
  const stateList = sql.join(LIVE_STATES.map((s) => sql`${s}`), sql`, `);

  // 1. unapproved_estimate: the estimate later matched an invoice → WON
  //    (direct linkage); or the customer answered with a closed signal
  //    (repaired elsewhere / sold / not interested) → lost.
  try {
    const matched = rowsFromExecute(await db.execute(sql`
      SELECT o.id, e.matched_invoice_id AS invoiceId
      FROM revenue_opportunities o
      JOIN alg_estimates e ON e.id = CAST(o.source_id AS UNSIGNED)
      WHERE o.source_type = 'unapproved_estimate'
        AND o.state IN (${stateList})
        AND e.matched_invoice_id IS NOT NULL
      LIMIT 100
    `));
    stats.checked += matched.length;
    for (const r of matched) {
      const res = await recordOutcome({
        id: String(r.id),
        invoiceId: Number(r.invoiceId),
        by: "reconciler",
      });
      if (res.ok) stats.won++;
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] estimate-won reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  try {
    const answered = rowsFromExecute(await db.execute(sql`
      SELECT o.id, e.stated_concern AS concern
      FROM revenue_opportunities o
      JOIN alg_estimates e ON e.id = CAST(o.source_id AS UNSIGNED)
      WHERE o.source_type = 'unapproved_estimate'
        AND o.state IN (${stateList})
        AND e.stated_concern IN ('repaired_elsewhere', 'no_longer_owns', 'not_interested')
      LIMIT 100
    `));
    stats.checked += answered.length;
    for (const r of answered) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: `source resolved: customer stated ${String(r.concern)}`,
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isMissingTableError(err) && !/unknown column|1054/i.test(msg)) {
      log.warn("[opportunity-queue] estimate-concern reconciler failed", { error: msg });
    }
  }

  // 2. callback: the callback_requests row left 'new' (someone handled
  //    it in the callbacks admin) → close the queue's copy.
  try {
    const handled = rowsFromExecute(await db.execute(sql`
      SELECT o.id, c.status AS cbStatus
      FROM revenue_opportunities o
      JOIN callback_requests c ON c.id = CAST(o.source_id AS UNSIGNED)
      WHERE o.source_type = 'callback'
        AND o.state IN (${stateList})
        AND c.status != 'new'
      LIMIT 100
    `));
    stats.checked += handled.length;
    for (const r of handled) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: `source resolved: callback_requests status=${String(r.cbStatus)} (handled outside the queue)`,
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] callback reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. missed_call: a week-old missed call is not an actionable owner
  //    decision anymore — age it out instead of letting it pin the inbox.
  try {
    const stale = rowsFromExecute(await db.execute(sql`
      SELECT id FROM revenue_opportunities
      WHERE source_type = 'missed_call'
        AND state IN (${stateList})
        AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
      LIMIT 100
    `));
    stats.checked += stale.length;
    for (const r of stale) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: "aged out: missed call older than 7 days",
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] missed-call reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. deferred_service: every flagged item on the inspection now has a
  //    non-declined decision → the deferral resolved (the customer
  //    engaged; approved work is active business, not a chase).
  try {
    const resolved = rowsFromExecute(await db.execute(sql`
      SELECT o.id
      FROM revenue_opportunities o
      WHERE o.source_type = 'deferred_service'
        AND o.state IN (${stateList})
        AND NOT EXISTS (
          SELECT 1
          FROM inspection_items i
          WHERE i.inspectionId = CAST(SUBSTRING(o.source_id, 12) AS UNSIGNED)
            AND i.condition IN ('red', 'yellow')
            AND (i.decision IS NULL OR i.decision = 'declined')
        )
      LIMIT 100
    `));
    stats.checked += resolved.length;
    for (const r of resolved) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: "source resolved: every flagged inspection item now has a customer decision",
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isMissingTableError(err) && !/unknown column|1054/i.test(msg)) {
      log.warn("[opportunity-queue] deferral reconciler failed", { error: msg });
    }
  }

  return stats;
}

/** Cron entry: reconcile resolved sources FIRST, then run all collectors.
 * Read-only against sources; writes only the queue. recordsProcessed
 * counts REAL changes only (new rows + closures + wins) — refreshes of
 * existing rows are reported separately and never read as production. */
export async function refreshOpportunityQueue(): Promise<{ recordsProcessed: number; details: string }> {
  const reconciled = await reconcileOpportunities();
  const estimates = await collectUnapprovedEstimates();
  const callbacks = await collectPendingCallbacks();
  const missedCalls = await collectMissedCalls();
  const inspections = await collectInspectionDeferrals();
  const fmt = (s: CollectorStats) => `${s.inserted}new/${s.refreshed}ref/${s.scanned}scan`;
  let details =
    `reconciled: ${reconciled.won}won+${reconciled.closed}closed/${reconciled.checked} · ` +
    `estimates: ${fmt(estimates)} · callbacks: ${fmt(callbacks)} · ` +
    `missed calls: ${fmt(missedCalls)} · deferrals: ${fmt(inspections)}`;
  const recordsProcessed =
    reconciled.won + reconciled.closed +
    estimates.inserted + callbacks.inserted + missedCalls.inserted + inspections.inserted;

  // Strike-4: the loop judges its own shape. The contract was built to
  // catch "cron looks productive while changing nothing" — with
  // recordsProcessed now counting only REAL changes, classifyRun can
  // tell dormant from quiet. Best-effort: shape-judging must never fail
  // the refresh itself.
  try {
    const { classifyRun } = await import("./loopShapeContract");
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    let priorZeroRuns = 0;
    let runsInWindow = 1;
    if (db) {
      const hist = rowsFromExecute(await db.execute(sql`
        SELECT records_processed AS produced, started_at
        FROM cron_log
        WHERE job_name = 'opportunity-queue-refresh'
          AND status = 'completed'
          AND COALESCE(details, '') NOT LIKE '%skipped%'
        ORDER BY started_at DESC
        LIMIT 20
      `));
      for (const h of hist) {
        if (Number(h.produced ?? 0) === 0) priorZeroRuns++;
        else break;
      }
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      runsInWindow = 1 + hist.filter((h) => new Date(h.started_at as string).getTime() >= weekAgo).length;
    }
    const finding = classifyRun({
      loop: "opportunity-queue-refresh",
      produced: recordsProcessed,
      succeeded: true,
      details,
      priorZeroRuns,
      runsInWindow,
    });
    if (finding.actionable) {
      details += ` · shape:${finding.verdict} — ${finding.summary}`;
      log.warn("[opportunity-queue] loop shape actionable", {
        verdict: finding.verdict,
        summary: finding.summary,
      });
    }
  } catch (err) {
    log.warn("[opportunity-queue] loop-shape classification failed (refresh unaffected)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { recordsProcessed, details };
}
