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

/**
 * The owner's top-N decisions: live, consented, ranked by the transparent
 * score. Excluded (not silently — counted): non-consent rows and
 * terminal states.
 */
export async function topDecisions(n = 5): Promise<{
  decisions: RankedDecision[];
  excludedNoConsent: number;
  totalLive: number;
}> {
  const live = await listOpportunities({
    states: ["new", "assigned", "attempted", "contacted", "scheduled", "walk_in_expected", "arrived", "no_response"],
    limit: 200,
  });
  const consented = live.filter((o) => o.consentOk);
  // Sort: urgency first, then score. A value-unknown critical callback
  // (customer explicitly asked for a call) must outrank a mid-value
  // inferred estimate — and we never invent dollars to make that happen,
  // so urgency is the primary axis and the value-score breaks ties.
  const ranked = consented
    .map((o) => ({
      ...o,
      ...rankOpportunity({
        expectedRevenueCents: o.expectedRevenueCents,
        urgency: o.urgency,
        dataQuality: o.dataQuality,
      }),
    }))
    .sort((a, b) =>
      b.factors.urgencyWeight !== a.factors.urgencyWeight
        ? b.factors.urgencyWeight - a.factors.urgencyWeight
        : b.score - a.score,
    )
    .slice(0, n);
  return {
    decisions: ranked,
    excludedNoConsent: live.length - consented.length,
    totalLive: live.length,
  };
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
 * The ONLY path to `won`. Requires a real invoice: the invoice row is
 * looked up first, and the transition stores the id + verification time.
 * Roadmap: "measure recovery only from verified later outcomes."
 */
export async function recordOutcome(params: {
  id: string;
  invoiceId: number;
  by: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };

  try {
    const invoiceRows = rowsFromExecute(
      await db.execute(sql`SELECT id FROM invoices WHERE id = ${params.invoiceId} LIMIT 1`),
    );
    if (invoiceRows.length === 0) {
      return { ok: false, error: `invoice ${params.invoiceId} not found — won requires a verified invoice` };
    }

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
      from: current.state,
      to: "won",
      invoiceId: params.invoiceId,
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
    return { ok: true };
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
 * Unresolved ALG estimates (7-60d old, ≥ $150) → unapproved_estimate
 * opportunities. data_quality is "inferred" BY DESIGN: an unmatched
 * estimate is unresolved, not proven-declined (revenue-truth doctrine).
 * Consent is read from customers.smsOptOut via the phone-last10 join the
 * recovery cron already uses.
 */
export async function collectUnapprovedEstimates(): Promise<{ scanned: number; upserted: number }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, upserted: 0 };

  const MIN_CENTS = 15_000; // below $150 it's not an owner-level decision
  let rows: Array<Record<string, unknown>>;
  try {
    rows = rowsFromExecute(await db.execute(sql`
      SELECT e.id, e.customer_name AS customerName, e.customer_phone AS customerPhone,
             e.service_description AS serviceDescription, e.estimated_amount AS estimatedAmount,
             e.estimate_date AS estimateDate,
             e.follow_up_7d_sent AS f7, e.follow_up_30d_sent AS f30,
             c.id AS customerId, c.smsOptOut AS smsOptOut
      FROM alg_estimates e
      LEFT JOIN customers c
        ON RIGHT(REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', ''), 10)
         = RIGHT(REGEXP_REPLACE(COALESCE(e.customer_phone, ''), '[^0-9]', ''), 10)
       AND e.customer_phone IS NOT NULL
      WHERE e.matched_invoice_id IS NULL
        AND e.estimate_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
        AND e.estimate_date <= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND e.estimated_amount >= ${MIN_CENTS}
      LIMIT 300
    `));
  } catch (err) {
    log.warn("[opportunity-queue] estimate collector query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, upserted: 0 };
  }

  let upserted = 0;
  for (const r of rows) {
    const amountCents = Number(r.estimatedAmount ?? 0);
    const ageDays = r.estimateDate
      ? Math.floor((Date.now() - new Date(r.estimateDate as string).getTime()) / 86_400_000)
      : 0;
    const touches = (Number(r.f7 ?? 0) ? 1 : 0) + (Number(r.f30 ?? 0) ? 1 : 0);
    const name = r.customerName ? String(r.customerName) : "customer";
    const service = r.serviceDescription ? String(r.serviceDescription).slice(0, 80) : "quoted work";
    const res = await upsertOpportunity({
      sourceType: "unapproved_estimate",
      sourceId: String(r.id),
      customerId: r.customerId == null ? null : Number(r.customerId),
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
      },
      consentOk: Number(r.smsOptOut ?? 0) !== 1,
    });
    if (res !== "unavailable") upserted++;
    else return { scanned: rows.length, upserted }; // table missing — stop early
  }
  return { scanned: rows.length, upserted };
}

/**
 * Pending callback requests → callback opportunities. data_quality is
 * "verified" (the customer explicitly asked to be called) and urgency
 * critical — this is the highest-signal row the queue can hold.
 */
export async function collectPendingCallbacks(): Promise<{ scanned: number; upserted: number }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, upserted: 0 };

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
    return { scanned: 0, upserted: 0 };
  }

  let upserted = 0;
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
    if (res !== "unavailable") upserted++;
    else return { scanned: rows.length, upserted };
  }
  return { scanned: rows.length, upserted };
}

/** Cron entry: run all collectors. Read-only against sources; writes only the queue. */
export async function refreshOpportunityQueue(): Promise<{ recordsProcessed: number; details: string }> {
  const estimates = await collectUnapprovedEstimates();
  const callbacks = await collectPendingCallbacks();
  const details =
    `estimates: ${estimates.upserted}/${estimates.scanned} upserted · ` +
    `callbacks: ${callbacks.upserted}/${callbacks.scanned} upserted`;
  return { recordsProcessed: estimates.upserted + callbacks.upserted, details };
}
