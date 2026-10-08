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
import { isMissingTableError, isUnknownColumnError } from "../lib/dbErrors";
import { normalizePhone } from "./revenueAttribution";

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
  // 2026-09-07 · the honest close. Added because the vocabulary had no way to
  // say "this is not worth acting on" without asserting something false:
  //   lost           — claims a sale was lost
  //   do_not_contact — sets consent_ok=0 for that PHONE, forever, from any UI
  //   duplicate      — claims this row duplicates another (since 2026-10-02 the
  //                    missed-call reconciler writes it: same-phone collapse, and
  //                    "served by another channel" — see reconcile step 3a)
  //   snooze         — neutral, but time-boxed and not a close
  // An operator hiding an irrelevant row was forced to pick a lie. `dismissed`
  // records exactly what happened: a human looked and judged it not actionable.
  //
  // WIDTH: `revenue_opportunities.state` is VARCHAR(24) (drizzle/0099:34) and
  // the longest value written today is `walk_in_expected` (16), so "dismissed"
  // (9) needs NO migration. 0099 chose VARCHAR over ENUM precisely so a new
  // state costs no DDL — TiDB STRICT_TRANS_TABLES rejects an out-of-enum write
  // and loses the row.
  "dismissed",
] as const;
export type OpportunityState = (typeof OPPORTUNITY_STATES)[number];

export const TERMINAL_STATES: readonly OpportunityState[] = [
  "won",
  "lost",
  "do_not_contact",
  "duplicate",
  "dismissed",
];

/**
 * Allowed forward transitions. `won` is deliberately ABSENT from every
 * list — it is only reachable through recordOutcome() with a verified
 * invoice. do_not_contact is reachable from every live state (consent
 * supremacy) and is added in canTransition rather than listed per-state.
 * `dismissed` is likewise reachable from every live state and added in
 * canTransition — a human may judge any live row not actionable.
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
  dismissed: [],
};

export function canTransition(from: OpportunityState, to: OpportunityState): boolean {
  if (from === to && from === "attempted") return true; // re-attempt bumps the counter
  if (TERMINAL_STATES.includes(from)) return false;
  if (to === "do_not_contact") return true; // consent supremacy from any live state
  // The neutral close, from any live state. Deliberately NOT gated per-state:
  // the whole point is that a human can always say "not actionable" without
  // being forced into `lost` (falsifies a sale) or `do_not_contact` (falsifies
  // consent, and suppresses the whole phone number).
  if (to === "dismissed") return true;
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

/** Last-10-digit phone key (the house join rule, revenueAttribution.normalizePhone), or null. */
export function phone10(p: unknown): string | null {
  return normalizePhone(p == null ? null : String(p));
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
  /**
   * Reopen a CLOSED row when this upsert carries materially new evidence.
   *
   * Off by default, and it must stay that way: the whole reason a dismissal is
   * durable is that ON DUPLICATE KEY UPDATE never touches `state`. A collector
   * that re-derives the same standing fact every run (a stale lead is still
   * stale) must NOT set this, or dismissal becomes a no-op and the operator is
   * back to swatting the same card forever.
   *
   * Set it only where a NEW REAL-WORLD EVENT produced this call — currently just
   * `captureComplaintOpportunity`, which fires on an inbound complaint SMS the
   * customer actually sent. `do_not_contact` is never reopened: consent outranks
   * evidence.
   */
  reopenIfTerminal?: boolean;
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
    const outcome = (raw.affectedRows ?? 1) >= 2 ? "refreshed" : "inserted";

    // Materially-new-evidence reopen. Separate statement on purpose: the INSERT
    // above must keep its exact ON DUPLICATE KEY UPDATE list, which deliberately
    // never writes `state`. Scoped by an explicit state IN (...) so it can only
    // ever move a CLOSED row back to `new`, never disturb a live one, and never
    // touch `do_not_contact` — consent outranks evidence.
    if (input.reopenIfTerminal && outcome === "refreshed") {
      try {
        // Receipts are built in JS and written whole, matching
        // transitionOpportunity. An earlier draft did the append SQL-side with
        // JSON_ARRAY_APPEND + CAST(... AS JSON) — an idiom used NOWHERE else in
        // this codebase and unproven against TiDB, in a write path whose only
        // failure signal is a log line. The house pattern is proven; a novel
        // one here would have degraded silently to "reopen never happens".
        const existing = rowsFromExecute(
          await db.execute(sql`
            SELECT id, state, receipts_json FROM revenue_opportunities
            WHERE source_type = ${input.sourceType} AND source_id = ${input.sourceId}
            LIMIT 1
          `),
        );
        const row = existing[0];
        const currentState = row ? String(row.state ?? "") : "";
        if (row && ["lost", "duplicate", "dismissed"].includes(currentState)) {
          const priorReceipts = mapRow(row).receipts;
          const receipts = [
            ...priorReceipts,
            {
              at: new Date().toISOString(),
              by: "system:new-evidence",
              from: currentState,
              to: "new",
              note: `reopened by new ${input.sourceType} evidence`,
            },
          ];
          // The state guard stays in the WHERE clause, not just the JS check —
          // a concurrent transition between the read and the write must lose,
          // not be overwritten. Losing that race simply means no reopen.
          await db.execute(sql`
            UPDATE revenue_opportunities
            SET state = 'new',
                due_at = NULL,
                receipts_json = ${JSON.stringify(receipts)},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${row.id}
              AND state = ${currentState}
          `);
        }
      } catch (reopenErr) {
        // A failed reopen must not lose the upsert; the row is still refreshed
        // and the next event retries. Loud, because a silently un-reopened
        // complaint is a customer nobody called back.
        log.warn("[opportunity-queue] reopen-on-new-evidence failed", {
          sourceType: input.sourceType,
          error: reopenErr instanceof Error ? reopenErr.message : String(reopenErr),
        });
      }
    }
    return outcome;
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("upsert");
      return "unavailable";
    }
    throw err;
  }
}

// ─── Reads ──────────────────────────────────────────────────────────

/**
 * 2026-09-07 · `queryable` added here, mirroring topDecisions().
 *
 * #1340 added `queryable` to topDecisions() precisely so an UNCONSULTABLE queue
 * would stop reading as a CLEAR one — and wired it to the cron, the LLM query
 * route and the admin panel. It was never applied to this sibling, which kept
 * returning a bare `[]` on both failure exits: no database handle (`if (!db)`)
 * and `revenue_opportunities` missing. A caller cannot tell those apart from a
 * genuinely empty queue.
 *
 * That was survivable while nothing rendered this function. The staff Follow-ups
 * tab renders it, so "we could not read the queue" would have printed as "you
 * have no follow-ups" — the same defect #1340 closed, re-opened one function to
 * the left. Fixing the SUBJECT rather than one instance of it is the point.
 *
 * Returns `{ items, queryable }`, deliberately not a bare array, so the honest
 * shape cannot be ignored by a future caller: `.length` on the result is a type
 * error rather than a silent zero.
 */
export async function listOpportunities(opts?: {
  states?: OpportunityState[];
  limit?: number;
}): Promise<{ items: OpportunityRow[]; queryable: boolean }> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { items: [], queryable: false };

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
    return { items: rowsFromExecute(result).map(mapRow), queryable: true };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("list");
      return { items: [], queryable: false };
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
  /**
   * ROS-083 · false when the queue could not be CONSULTED at all — no database
   * handle, or revenue_opportunities does not exist because migration 0099 has
   * not been applied. Both of those already returned the same empty result as
   * "asked, and there is genuinely nothing to do", and the difference matters:
   * the morning brief tells the LLM that an absent TOP DECISIONS block means
   * there are no queued decisions, and it then writes the operator's top-3
   * priorities from scratch. An unmeasured queue must not read as a quiet one.
   *
   * Additive and optional-by-convention: shared/bridgeShapes.ts TopDecisionsShape
   * is a non-strict z.object, so existing consumers that never look at this
   * field keep parsing unchanged.
   */
  queryable: boolean;
}> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { decisions: [], excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 0, queryable: false };

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
      queryable: true,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      warnMissingOnce("topDecisions");
      return { decisions: [], excludedNoConsent: 0, excludedSnoozed: 0, totalLive: 0, queryable: false };
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
 * The one exception (Q-37): an estimate the counter captured as declined
 * (declined_work_captures) is an observed decline and is "verified" —
 * see estimateOpportunityLabel in shared/declineProvenance.ts.
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
             e.estimated_parts_cost AS estimatedPartsCost,
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
    if (isUnknownColumnError(err)) {
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

  // Q-37 · counter-captured declines are OBSERVED; the rest stay inferred.
  const { readDeclineCaptures } = await import("./declineCaptures");
  const { declineProvenance, estimateOpportunityLabel } = await import("../../shared/declineProvenance");
  const captures = await readDeclineCaptures(rows.map((r) => Number(r.id)));

  let inserted = 0;
  let refreshed = 0;
  for (const r of rows) {
    const amountCents = Number(r.estimatedAmount ?? 0);
    const ageDays = r.estimateDate
      ? Math.floor((Date.now() - new Date(r.estimateDate as string).getTime()) / 86_400_000)
      : 0;
    const touches = (Number(r.f7 ?? 0) ? 1 : 0) + (Number(r.f30 ?? 0) ? 1 : 0);
    const provenance = declineProvenance(Number(r.id), captures);
    const label = estimateOpportunityLabel(provenance, ageDays, touches);
    const name = r.customerName ? String(r.customerName) : "customer";
    const service = r.serviceDescription ? String(r.serviceDescription).slice(0, 80) : "quoted work";
    const identity = resolveEstimateIdentity({
      matchCount: Number(r.matchCount ?? 0),
      anyCustomerId: r.anyCustomerId == null ? null : Number(r.anyCustomerId),
      anyOptOut: Number(r.anyOptOut ?? 0) === 1,
    });
    // Strike-6: quote-guard's cheap checks ride every estimate
    // opportunity into the Decision Inbox — the guard's first real
    // consumer (repo search found zero callers of the endpoint). Only
    // the zero-IO checks run here; the full report (supplier/overlap)
    // stays on the on-demand endpoint.
    const partsCostCents = Number(r.estimatedPartsCost ?? 0);
    const amountSane = amountCents >= 2_000 && amountCents <= 2_000_000;
    const belowPartsCost = partsCostCents > 0 && amountCents < partsCostCents;
    const quoteFlags = {
      amountSane,
      partsCostCaptured: partsCostCents > 0,
      quoteRemainderAfterPartsCostPct:
        partsCostCents > 0 ? Math.round(((amountCents - partsCostCents) / amountCents) * 1000) / 10 : null,
      ...(belowPartsCost ? { belowPartsCost: true } : {}),
    };
    const res = await upsertOpportunity({
      sourceType: "unapproved_estimate",
      sourceId: String(r.id),
      customerId: identity.customerId,
      customerName: name,
      customerPhone: r.customerPhone == null ? null : String(r.customerPhone),
      expectedRevenueCents: amountCents,
      dataQuality: label.dataQuality,
      urgency: amountCents >= 80_000 ? "today" : "this_week",
      recommendedAction: `Call ${name} about the $${Math.round(amountCents / 100)} ${service} quote`,
      reason:
        label.reason +
        (belowPartsCost ? ` QUOTE GUARD: quote is BELOW captured parts cost ($${Math.round(partsCostCents / 100)}) — review before contacting.` : "") +
        (!amountSane ? " QUOTE GUARD: amount outside the $20-$20,000 sanity band — likely a data-entry slip." : ""),
      evidence: {
        estimateId: Number(r.id),
        estimateAgeDays: ageDays,
        serviceDescription: service,
        declineProvenance: provenance,
        recoveryTouchesSent: touches,
        statedConcern: r.statedConcern ? String(r.statedConcern) : null,
        quoteFlags,
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
export async function collectMissedCalls(): Promise<CollectorStats & { collapsed: number }> {
  const { getDbTyped } = await import("../db");
  const db = await getDbTyped();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0, collapsed: 0 };

  const { vapiCallLogs } = await import("../../drizzle/schema");
  const { and, gte, lte, isNull, isNotNull, desc } = await import("drizzle-orm");
  const { isMissedCallEligible, proveCapturedNothing } = await import("../cron/jobs/missedCallRecovery");

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
      // No convertedToLead filter: it means "reached a tool", not "captured a
      // lead". A tool-reaching call that saved nothing is still a missed call;
      // eligibility below admits it only with proof (same rule as the SMS cron).
      .where(and(
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
    return { scanned: 0, inserted: 0, refreshed: 0, collapsed: 0 };
  }

  // Collapse (2026-10-02): ONE live missed_call row per PHONE, and it is the
  // NEWEST call. The (source_type, source_id=vapiCallId) key is unchanged —
  // historic rows depend on it. A new call for a phone that already has a
  // live card is INSERTED and the phone's older un-worked cards collapse into
  // it as `duplicate`. (A first version skipped the new call instead, which
  // kept the OLDEST card: it aged out to `lost` at day 7 while the newer call
  // had left the 24h collector window — the customer's latest call vanished.)
  // An older card anyone has touched (assigned or worked — anything but
  // `new`) is left alone. Live rows are fetched ONCE per run; a failed read degrades to
  // per-call cards and reconcile step 3a collapses the leftovers next run.
  const liveByPhone = new Map<string, Array<{ id: string; sourceId: string; state: OpportunityState }>>();
  if (rows.length > 0) {
    try {
      const { sql } = await import("drizzle-orm");
      const live = rowsFromExecute(await db.execute(sql`
        SELECT id, source_id, state, customer_phone FROM revenue_opportunities
        WHERE source_type = 'missed_call'
          AND state IN (${sql.join(LIVE_STATES.map((s) => sql`${s}`), sql`, `)})
          AND customer_phone IS NOT NULL
        LIMIT 2000
      `));
      for (const l of live) {
        const p = phone10(l.customer_phone as string | null);
        if (!p) continue;
        const live = liveByPhone.get(p) ?? [];
        live.push({ id: String(l.id), sourceId: String(l.source_id), state: String(l.state) as OpportunityState });
        liveByPhone.set(p, live);
      }
    } catch (err) {
      if (!isMissingTableError(err)) {
        log.warn("[opportunity-queue] missed-call live-phone read failed (no collapse this run)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  let inserted = 0;
  let refreshed = 0;
  let collapsed = 0;
  /** Phones that got their (newest) card in this run. `collapsed` counts only cards CLOSED into it. */
  const cardedThisRun = new Set<string>();
  for (const r of rows) {
    const meta = (r.metadata ?? null) as Record<string, unknown> | null;
    const base = {
      id: r.id,
      vapiCallId: r.vapiCallId,
      phoneNumber: r.phoneNumber,
      durationSeconds: r.durationSeconds,
      convertedToLead: r.convertedToLead,
      leadId: r.leadId,
      callbackId: r.callbackId,
      recoveryAlreadyStamped: false, // recovery SMS state doesn't gate a human call-back
      createdAtMs: new Date(r.createdAt).getTime(),
    };
    // The evidence read runs only for tool-reaching calls that pass every other rule.
    const capturedNothing = r.convertedToLead === 1 && isMissedCallEligible({ ...base, capturedNothing: true }, now)
      ? await proveCapturedNothing(r.vapiCallId)
      : undefined;
    const eligible = isMissedCallEligible({ ...base, capturedNothing }, now);
    if (!eligible) continue;

    const p10 = phone10(r.phoneNumber);
    const livePhone = p10 ? liveByPhone.get(p10) : undefined;
    // A call OLDER than one already carded this run (rows are newest-first) is
    // the redial's predecessor: it collapses into the newer card, not inserted.
    if (p10 && cardedThisRun.has(p10)) continue;

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
    if (res === "inserted" || res === "refreshed") {
      if (res === "inserted") inserted++;
      else refreshed++;
      // The phone's NEWEST call is now handled, whatever its card's state: its older
      // calls are never carded this run. (Marking only LIVE cards let an operator's
      // dismissal of the newest card resurrect the phone's older calls as fresh cards.)
      if (p10) cardedThisRun.add(p10);
      // Collapse only into a LIVE card: a refresh of a call whose card an operator
      // dismissed (or that was closed) must not close the phone's remaining live card into it.
      const cardIsLive = res === "inserted" || (livePhone ?? []).some((l) => l.sourceId === r.vapiCallId);
      if (p10 && cardIsLive) {
        // Older UNTOUCHED (`new`) cards for this phone collapse into this newer call.
        // An assigned card has an owner: it is left to them.
        for (const older of livePhone ?? []) {
          if (older.sourceId === r.vapiCallId || older.state !== "new" || !canTransition(older.state, "duplicate")) continue;
          const t = await transitionOpportunity({
            id: older.id,
            to: "duplicate",
            by: "collector",
            note: `collapsed into newer missed call ${r.vapiCallId.slice(0, 12)} (same phone)`,
          });
          if (t.ok) collapsed++;
        }
        liveByPhone.delete(p10);
      }
    } else return { scanned: rows.length, inserted, refreshed, collapsed };
  }
  return { scanned: rows.length, inserted, refreshed, collapsed };
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
/**
 * Stale website leads → stale_lead opportunities (2026-07-29, speed-to-lead
 * closure). The staleLeadFollowup cron only works the 2h–24h window; leads
 * older than 24h previously fell out of EVERY rail forever (the only trace
 * was a display-only risk card). This collector gives them a durable
 * Decision-Inbox row instead of a surprise text:
 *
 *   0–2h    → human's window (untouched — no row, no automation)
 *   2–24h   → staleLeadFollowup cron's territory (untouched)
 *   24h–30d → THIS collector: ranked owner decision, call-first framing
 *   >30d    → reconciler ages the row out (and none are ever inserted)
 *
 * Excluded sources: 'careers' (job applicants are not revenue — AG-43) and
 * 'callback' (callback_requests already feeds the queue via its own
 * collector; a second row for the same ask would double-represent them).
 * Value is estimatedValueCents when a quote was actually given, else null —
 * never an invented average. NEVER sends anything.
 */
export async function collectStaleLeads(): Promise<CollectorStats> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0 };

  let rows: Array<Record<string, unknown>>;
  try {
    rows = rowsFromExecute(await db.execute(sql`
      SELECT id, name, phone, vehicle, problem, source, recommendedService,
             estimatedValueCents, urgencyScore, createdAt
      FROM leads
      WHERE status = 'new'
        AND contacted = 0
        AND source NOT IN ('careers', 'callback')
        AND createdAt <= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND createdAt > DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY createdAt DESC
      LIMIT 100
    `));
  } catch (err) {
    log.warn("[opportunity-queue] stale-lead collector query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, inserted: 0, refreshed: 0 };
  }

  let inserted = 0;
  let refreshed = 0;
  for (const r of rows) {
    const name = r.name ? String(r.name) : "customer";
    const ageDays = r.createdAt
      ? Math.max(1, Math.round((Date.now() - new Date(r.createdAt as string).getTime()) / 86_400_000))
      : 1;
    const service = r.recommendedService
      ? String(r.recommendedService)
      : r.problem
        ? String(r.problem).slice(0, 60)
        : "their request";
    const res = await upsertOpportunity({
      sourceType: "stale_lead",
      sourceId: String(r.id),
      customerName: name,
      customerPhone: r.phone == null ? null : String(r.phone),
      expectedRevenueCents: r.estimatedValueCents == null ? null : Number(r.estimatedValueCents),
      // The lead row is the customer's own submission — its existence is
      // verified; the VALUE stays null unless a quote was actually recorded.
      dataQuality: "verified",
      // 24h–7d: still warm enough for this week; older: later. Callbacks/
      // complaints (critical/today) always outrank these by construction.
      urgency: ageDays <= 7 ? "this_week" : "later",
      recommendedAction: `Call ${name} — website lead about ${service} has waited ${ageDays}d with no contact`,
      reason: `Lead submitted ${ageDays} days ago via ${String(r.source)} and was never contacted. Speed-to-lead window is gone — a personal call beats an automated text this late.`,
      evidence: {
        leadId: Number(r.id),
        source: String(r.source),
        ageDays,
        vehicle: r.vehicle ? String(r.vehicle) : null,
        problem: r.problem ? String(r.problem).slice(0, 200) : null,
        urgencyScore: r.urgencyScore == null ? null : Number(r.urgencyScore),
        quoteOnFile: r.estimatedValueCents != null,
      },
      consentOk: true, // they submitted the form asking to be contacted
    });
    if (res === "inserted") inserted++;
    else if (res === "refreshed") refreshed++;
    else return { scanned: rows.length, inserted, refreshed };
  }
  return { scanned: rows.length, inserted, refreshed };
}

/**
 * No-show booking requests → no_show_booking opportunities (Autopilot Wave 2,
 * 2026-07-29). A booking REQUEST (this is an FCFS walk-in shop — requests,
 * not appointments) whose preferred date passed ≥1 day ago while the row
 * still sits new/confirmed means the loop was never closed: nobody knows if
 * they came, went elsewhere, or forgot. data_quality is `inferred` BY DESIGN
 * — a preferred date is a stated intention, not a confirmed appointment, so
 * this must never be framed as "missed appointment" to the customer.
 * Value stays null (no invented dollars). NEVER sends.
 */
export async function collectNoShowBookings(): Promise<CollectorStats> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0 };

  let rows: Array<Record<string, unknown>>;
  try {
    // preferredDate is a free-text varchar; only ISO-shaped values are
    // trusted (STR_TO_DATE on garbage yields NULL and drops the row).
    rows = rowsFromExecute(await db.execute(sql`
      SELECT id, name, phone, service, vehicle, preferredDate, createdAt
      FROM bookings
      WHERE status IN ('new', 'confirmed')
        AND phone IS NOT NULL AND phone != ''
        AND preferredDate REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND STR_TO_DATE(SUBSTRING(preferredDate, 1, 10), '%Y-%m-%d') IS NOT NULL
        AND STR_TO_DATE(SUBSTRING(preferredDate, 1, 10), '%Y-%m-%d') < DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        AND createdAt > DATE_SUB(NOW(), INTERVAL 60 DAY)
      ORDER BY createdAt DESC
      LIMIT 100
    `));
  } catch (err) {
    log.warn("[opportunity-queue] no-show collector query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, inserted: 0, refreshed: 0 };
  }

  let inserted = 0;
  let refreshed = 0;
  for (const r of rows) {
    const name = r.name ? String(r.name) : "customer";
    const service = r.service ? String(r.service).slice(0, 50) : "service";
    const date = String(r.preferredDate ?? "").slice(0, 10);
    const res = await upsertOpportunity({
      sourceType: "no_show_booking",
      sourceId: String(r.id),
      customerName: name,
      customerPhone: r.phone == null ? null : String(r.phone),
      expectedRevenueCents: null, // intention ≠ dollars — never invent
      dataQuality: "inferred",
      urgency: "this_week",
      recommendedAction: `Call ${name} — asked about coming in ${date} for ${service}; the loop was never closed`,
      reason: `Booking request said ${date}; that date passed with the request still open. Unknown whether they came, went elsewhere, or forgot — a quick call answers it.`,
      evidence: {
        bookingId: Number(r.id),
        preferredDate: date,
        service,
        vehicle: r.vehicle ? String(r.vehicle) : null,
      },
      consentOk: true, // they asked to come in
    });
    if (res === "inserted") inserted++;
    else if (res === "refreshed") refreshed++;
    else return { scanned: rows.length, inserted, refreshed };
  }
  return { scanned: rows.length, inserted, refreshed };
}

/**
 * Overdue human-pending SMS conversations → human_pending_sms opportunities
 * (Autopilot Wave 2). ROS-058 made waiting customers durable
 * (sms_response_jobs status='human_pending' with an SLA dueAt) and Telegram
 * nags exist — but the Decision Inbox, the ONE ranked surface, never showed
 * them. A customer waiting past SLA is the single most urgent row the queue
 * can hold: verified (their own inbound text), critical, and rotting by the
 * minute. NEVER sends — the operator answers from the SMS admin.
 */
export async function collectOverdueHumanPending(): Promise<CollectorStats> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0 };

  let rows: Array<Record<string, unknown>>;
  try {
    rows = rowsFromExecute(await db.execute(sql`
      SELECT id, customerPhone, body, createdAt, dueAt
      FROM sms_response_jobs
      WHERE status = 'human_pending'
        AND dueAt < NOW()
      ORDER BY createdAt ASC
      LIMIT 50
    `));
  } catch (err) {
    log.warn("[opportunity-queue] human-pending collector query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, inserted: 0, refreshed: 0 };
  }

  let inserted = 0;
  let refreshed = 0;
  for (const r of rows) {
    const waitedMin = r.createdAt
      ? Math.max(1, Math.round((Date.now() - new Date(r.createdAt as string).getTime()) / 60_000))
      : 1;
    const preview = r.body ? String(r.body).slice(0, 80) : "";
    const res = await upsertOpportunity({
      sourceType: "human_pending_sms",
      sourceId: String(r.id),
      customerName: null,
      customerPhone: r.customerPhone == null ? null : String(r.customerPhone),
      expectedRevenueCents: null,
      dataQuality: "verified", // the customer's own text is the evidence
      urgency: "critical",
      recommendedAction: `Answer the waiting text (${waitedMin}m) — "${preview}"`,
      reason: `A customer texted ${waitedMin} minutes ago, the AI routed it to a human, and nobody has answered. Past the 30-min SLA.`,
      evidence: {
        responseJobId: Number(r.id),
        waitedMinutes: waitedMin,
        inboundPreview: preview,
      },
      consentOk: true, // replying to their own inbound message
    });
    if (res === "inserted") inserted++;
    else if (res === "refreshed") refreshed++;
    else return { scanned: rows.length, inserted, refreshed };
  }
  return { scanned: rows.length, inserted, refreshed };
}

/**
 * Abandoned forms → abandoned_form opportunities (Autopilot Wave 6,
 * 2026-07-29 · mission P5 "abandoned forms without subsequent contact").
 * The one-shot recovery SMS covers 30min–2h; a partial older than that with
 * a phone and NO subsequent lead/booking from the same person previously
 * fell out of every rail. Window 2h–14d. data_quality `partial` BY DESIGN —
 * they typed but did not submit; the weakest evidence class in the queue,
 * so ranking keeps them below everything verified. Value null. Call-first
 * framing. NEVER sends.
 */
export async function collectAbandonedForms(): Promise<CollectorStats> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { scanned: 0, inserted: 0, refreshed: 0 };

  let rows: Array<Record<string, unknown>>;
  const convertedPhones = new Map<string, number>(); // last10 → earliest convert ts
  try {
    // Runtime-truth-pass fix (2026-07-29): the first version excluded
    // subsequent converters with correlated NOT EXISTS whose join keys were
    // REPLACE() chains on BOTH sides — unindexable, O(forms × leads×bookings)
    // full scans that stalled a live refresh for 20+ minutes. Same cure as
    // the stale-lead dedupe guard: fetch the (small, windowed) lead/booking
    // phone sets ONCE and filter in JS by last-10.
    rows = rowsFromExecute(await db.execute(sql`
      SELECT sessionId, formType, name, phone, service, createdAt
      FROM abandoned_forms
      WHERE phone IS NOT NULL AND LENGTH(phone) >= 10
        AND createdAt <= DATE_SUB(NOW(), INTERVAL 2 HOUR)
        AND createdAt > DATE_SUB(NOW(), INTERVAL 14 DAY)
      ORDER BY createdAt DESC
      LIMIT 100
    `));
    const [leadRows] = await db.execute(sql`
      SELECT phone, createdAt FROM leads
      WHERE phone IS NOT NULL AND createdAt > DATE_SUB(NOW(), INTERVAL 15 DAY)
      LIMIT 500
    `);
    const [bookingRows] = await db.execute(sql`
      SELECT phone, createdAt FROM bookings
      WHERE phone IS NOT NULL AND createdAt > DATE_SUB(NOW(), INTERVAL 15 DAY)
      LIMIT 500
    `);
    for (const r of [...(Array.isArray(leadRows) ? leadRows : []), ...(Array.isArray(bookingRows) ? bookingRows : [])]) {
      const row = r as { phone?: unknown; createdAt?: unknown };
      const p = String(row.phone ?? "").replace(/\D/g, "").slice(-10);
      if (p.length !== 10) continue;
      const ts = new Date(String(row.createdAt)).getTime();
      const prev = convertedPhones.get(p);
      if (prev === undefined || ts < prev) convertedPhones.set(p, ts);
    }
  } catch (err) {
    log.warn("[opportunity-queue] abandoned-form collector query failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, inserted: 0, refreshed: 0 };
  }
  // Drop partials whose person converted (lead/booking at-or-after abandonment).
  rows = rows.filter((r) => {
    const p = String(r.phone ?? "").replace(/\D/g, "").slice(-10);
    const convertedAt = convertedPhones.get(p);
    if (convertedAt === undefined) return true;
    const abandonedAt = new Date(String(r.createdAt)).getTime();
    return convertedAt < abandonedAt; // conversion BEFORE abandonment doesn't count
  });

  let inserted = 0;
  let refreshed = 0;
  for (const r of rows) {
    const name = r.name ? String(r.name) : "someone";
    const ageHours = r.createdAt
      ? Math.max(1, Math.round((Date.now() - new Date(r.createdAt as string).getTime()) / 3_600_000))
      : 1;
    const what = r.service ? String(r.service).slice(0, 50) : String(r.formType ?? "a form");
    const res = await upsertOpportunity({
      sourceType: "abandoned_form",
      sourceId: String(r.sessionId),
      customerName: r.name ? String(r.name) : null,
      customerPhone: r.phone == null ? null : String(r.phone),
      expectedRevenueCents: null, // a partial form is interest, never dollars
      dataQuality: "partial",
      urgency: ageHours <= 48 ? "this_week" : "later",
      recommendedAction: `Call ${name} — started ${what} on the site ${ageHours}h ago and never finished`,
      reason: `They typed a phone number into the ${String(r.formType ?? "form")} form but didn't submit, and no lead/booking followed. Something stopped them — a call answers what.`,
      evidence: {
        sessionId: String(r.sessionId),
        formType: String(r.formType ?? ""),
        service: r.service ? String(r.service).slice(0, 200) : null,
        abandonedAgoHours: ageHours,
      },
      consentOk: true, // they gave the shop their number in the shop's own form
    });
    if (res === "inserted") inserted++;
    else if (res === "refreshed") refreshed++;
    else return { scanned: rows.length, inserted, refreshed };
  }
  return { scanned: rows.length, inserted, refreshed };
}

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

    // 2026-09-07 · the day-key was REMOVED from this natural key.
    //
    // It used to be `${phone10}:${dayKey}` with dayKey = UTC yyyy-mm-dd. Every
    // other collector keys on the SOURCE ROW's own primary key, so dismissing an
    // item is durable: `uq_opportunity_source` collides and the ON DUPLICATE KEY
    // UPDATE above deliberately never touches `state`. A date in the key defeated
    // that entirely — the same complaining customer minted a BRAND NEW row every
    // day, whatever the operator did to yesterday's, and it counted in totalLive
    // each time. (The date was also UTC, so on Eastern the "day" rolled at 20:00
    // local — the day-bucket trap this repo documents.)
    //
    // Keyed on the phone alone, a dismissal now sticks. A genuinely NEW complaint
    // is still materially new evidence, so `reopenIfTerminal` below reopens a
    // closed row rather than silently swallowing the customer's second complaint
    // into a hidden one. Durable dismissal and a re-heard customer, not a choice
    // between them.
    const res = await upsertOpportunity({
      sourceType: "review_recovery",
      sourceId: phone10,
      reopenIfTerminal: true,
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
  items: Array<{ condition: string; decision: string | null; estimatedCost: number | null; photoUrl?: string | null; verifiedAt?: Date | string | null }>,
): { openFlagged: number; redOpen: number; valueCents: number; urgency: OpportunityUrgency; photoSupportedOpen: number } {
  // 0143 · a VERIFIED item is completed work (after-photo + after-measurement
  // recorded), never a deferral — whatever its decision column says.
  const open = items.filter(
    (i) =>
      (i.condition === "red" || i.condition === "yellow") &&
      (i.decision === null || i.decision === "declined") &&
      !i.verifiedAt,
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
    photoUrl: string | null; verifiedAt: Date | string | null;
  };
  // Column availability degrades in the order the migrations shipped: 0143
  // (verifiedAt) is newest, 0101 (decision) before it. Each attempt drops the
  // newest column the database reports unknown; a database with neither still
  // yields rows (every flagged item then counts as open and unverified).
  const baseQuery = (cols: { decision: boolean; verified: boolean }) => sql`
    SELECT v.id AS inspectionId, v.customerName AS customerName,
           v.customerPhone AS customerPhone, v.vehicleInfo AS vehicleInfo,
           DATEDIFF(NOW(), v.createdAt) AS publishedAgeDays,
           (v.bookingId IS NULL) AS unlinked,
           i.condition AS condition,
           ${cols.decision ? sql`i.decision` : sql`NULL`} AS decision,
           i.estimatedCost AS estimatedCost,
           i.photoUrl AS photoUrl,
           ${cols.verified ? sql`i.verifiedAt` : sql`NULL`} AS verifiedAt
    FROM vehicle_inspections v
    INNER JOIN inspection_items i ON i.inspectionId = v.id
    WHERE v.isPublished = 1
      AND v.createdAt >= DATE_SUB(NOW(), INTERVAL 60 DAY)
      AND i.condition IN ('red', 'yellow')
  `;
  let rows: Row[] | null = null;
  for (const cols of [{ decision: true, verified: true }, { decision: true, verified: false }, { decision: false, verified: false }]) {
    try {
      rows = rowsFromExecute(await db.execute(baseQuery(cols))) as unknown as Row[];
      break;
    } catch (err) {
      if (isUnknownColumnError(err)) continue;
      log.warn("[opportunity-queue] inspection collector query failed", { error: err instanceof Error ? err.message : String(err) });
      return { scanned: 0, inserted: 0, refreshed: 0 };
    }
  }
  if (!rows) return { scanned: 0, inserted: 0, refreshed: 0 };

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
        verifiedAt: i.verifiedAt ?? null,
      })),
    );
    if (s.openFlagged === 0) continue; // everything approved/answered/verified — no deferral

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

// ─── Missed-call closure semantics (2026-10-02) · pure, exported for tests ─
//
// Pre-fix, the only exit for a live missed_call row was the 7-day age-out to
// `lost` — a customer who called back, booked, or paid an invoice the next
// day still read as a lost sale a week later (866 `lost` rows, almost all
// age-outs). These helpers decide, per live row, whether LATER evidence for
// the same phone shows the customer was served. Evidence is matched on the
// last-10 phone key.
//
// Every time here is a shop-time (America/New_York) 'YYYY-MM-DD HH:MM:SS'
// string formatted IN SQL — driver-parsed TiDB timestamps shift on ET, and
// such strings compare correctly as plain strings. Non-invoice evidence must
// be STRICTLY after the anchor (the missed call's own time; the row's
// created_at when the call row is gone) — anything at or before the call
// cannot be the response to it. Invoices are compared by shop DAY, because
// their times are coarse (ingestion stamps a fixed hour of the invoice date):
//   - a PAID invoice on a LATER shop day → won candidate (recordOutcome
//     re-verifies it through classifyOutcomeMatch before anything becomes won);
//   - a paid invoice on the SAME shop day → the customer was in, but whether
//     before or after the call is unknowable → served (closes `new` as
//     duplicate), never counted as a win;
//   - an earlier day → not evidence.

export type MissedCallEvidenceSource =
  | "invoices"
  | "callback_requests"
  | "leads"
  | "bookings"
  | "vapi_call_logs";

export interface MissedCallServedEvidence {
  source: MissedCallEvidenceSource;
  id: number;
  phone: string | null;
  /** Shop-time 'YYYY-MM-DD HH:MM:SS', formatted in SQL. */
  at: string;
  /** extra receipt detail, e.g. "lead #12" for a captured follow-up call */
  detail?: string;
}

const SHOP_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** A well-formed SQL-formatted timestamp, or null — malformed input is never evidence. */
function shopTs(v: unknown): string | null {
  return typeof v === "string" && SHOP_TS.test(v) ? v : null;
}

/**
 * Earliest qualifying later-day invoice (→ won via recordOutcome) and earliest
 * qualifying service signal (→ served close) for one live row. Different
 * phone, unparseable phone or time, or evidence not after the anchor → null.
 */
export function decideMissedCallServed(input: {
  phone: string | null;
  anchorAt: string;
  evidence: readonly MissedCallServedEvidence[];
}): { invoice: MissedCallServedEvidence | null; served: MissedCallServedEvidence | null } {
  const p = phone10(input.phone);
  const anchor = shopTs(input.anchorAt);
  let invoice: MissedCallServedEvidence | null = null;
  let served: MissedCallServedEvidence | null = null;
  if (!p || !anchor) return { invoice, served };
  const anchorDay = anchor.slice(0, 10);
  for (const e of input.evidence) {
    if (phone10(e.phone) !== p) continue;
    const t = shopTs(e.at);
    if (!t) continue;
    let candidate = e;
    if (e.source === "invoices") {
      const day = t.slice(0, 10);
      if (day > anchorDay) {
        if (!invoice || t < invoice.at) invoice = e;
        continue;
      }
      if (day !== anchorDay) continue;
      candidate = { ...e, detail: "same shop day as the call; order unknown, not counted as won" };
    } else if (t <= anchor) {
      continue;
    }
    if (!served || t < served.at) served = candidate;
  }
  return { invoice, served };
}

/** Receipt note naming the exact evidence row. */
export function missedCallServedNote(e: MissedCallServedEvidence): string {
  return `served: ${e.source} #${e.id} at ${e.at} ET${e.detail ? ` (${e.detail})` : ""}`;
}

/**
 * Close state for "the customer was served by another channel": `duplicate`
 * (the need now lives in that other record) — and ONLY for an untouched
 * `new` card. An assigned card has an owner and a worked card
 * (attempted/contacted/…) has a person on it: NULL leaves it to them. (A first
 * version fell back to `lost` on worked rows, which booked every customer the
 * shop RECOVERED as a lost sale; a second auto-closed `assigned` rows out from
 * under the person assigned.) An invoice still closes any live row as `won`
 * via recordOutcome.
 */
export function servedCloseState(from: OpportunityState): "duplicate" | null {
  return from === "new" && canTransition(from, "duplicate") ? "duplicate" : null;
}

/**
 * Same-phone collapse plan over live missed_call rows: per phone, keep the
 * NEWEST call (ties → larger id, deterministic); older UNTOUCHED (`new`) rows
 * collapse into it as `duplicate`. A row anyone has touched (assigned or
 * worked) is never collapsed — it is reported in `skipped`. Rows without a
 * 10-digit phone are never grouped. `anchorAt` is a shop-time SQL string.
 */
export function planMissedCallCollapse(
  rows: ReadonlyArray<{ id: string; phone: string | null; anchorAt: string; state: OpportunityState }>,
): { collapse: Array<{ id: string; keepId: string }>; skipped: string[] } {
  const groups = new Map<string, Array<(typeof rows)[number]>>();
  for (const r of rows) {
    const p = phone10(r.phone);
    if (!p) continue;
    const g = groups.get(p) ?? [];
    g.push(r);
    groups.set(p, g);
  }
  const collapse: Array<{ id: string; keepId: string }> = [];
  const skipped: string[] = [];
  for (const g of Array.from(groups.values())) {
    if (g.length < 2) continue;
    const keep = g.reduce((a, b) => {
      const ta = shopTs(a.anchorAt) ?? "";
      const tb = shopTs(b.anchorAt) ?? "";
      return tb > ta || (tb === ta && b.id > a.id) ? b : a;
    });
    for (const r of g) {
      if (r.id === keep.id) continue;
      if (servedCloseState(r.state)) collapse.push({ id: r.id, keepId: keep.id });
      else skipped.push(r.id);
    }
  }
  return { collapse, skipped };
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
// receipt, not the coarse state, carries the truth). One exception: the
// missed-call step 3a writes `duplicate` where the transition table allows
// it, because "served by another channel" / "collapsed into a newer call"
// is literally a duplicate, and `lost` would falsely claim a lost sale.

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
    if (!isMissingTableError(err) && !isUnknownColumnError(err)) {
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

  // 3a. missed_call SERVED closure + same-phone collapse (2026-10-02). Runs
  //     BEFORE the age-out (3) so a customer who was served closes with the
  //     truth — `won` on a PAID invoice dated a later shop day (via
  //     recordOutcome, the only path to won), or served/duplicate on a later
  //     callback request, lead, booking, captured call or same-day paid
  //     invoice — instead of "aged out" a week later. Then live rows sharing
  //     a phone collapse into the newest. Served/collapse closes only touch
  //     untouched `new` cards (servedCloseState). Fetch-once + JS decide
  //     (the abandoned_form precedent): one bounded live read, one call-time
  //     read by unique vapiCallId, one evidence read per source filtered to
  //     the live phones and to times after the oldest anchor. A failed
  //     evidence read only means fewer closures this run, never a false one.
  try {
    // Two renderings per time, both formatted IN SQL: `raw` (the stored
    // value, for bounding later reads) and `et` (shop time, for deciding).
    const raw = (col: string) => sql.raw(`DATE_FORMAT(${col}, '%Y-%m-%d %H:%i:%s')`);
    const et = (col: string) =>
      sql.raw(`DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', 'America/New_York'), '%Y-%m-%d %H:%i:%s')`);
    const liveRaw = rowsFromExecute(await db.execute(sql`
      SELECT id, source_id, state, customer_phone,
             ${raw("created_at")} AS createdRaw, ${et("created_at")} AS createdEt
      FROM revenue_opportunities
      WHERE source_type = 'missed_call'
        AND state IN (${stateList})
      ORDER BY created_at DESC
      LIMIT 500
    `));
    if (liveRaw.length > 0) {
      const callAt = new Map<string, { raw: string; et: string }>();
      try {
        const calls = rowsFromExecute(await db.execute(sql`
          SELECT vapiCallId, ${raw("createdAt")} AS atRaw, ${et("createdAt")} AS atEt FROM vapi_call_logs
          WHERE vapiCallId IN (${sql.join(liveRaw.map((r) => sql`${String(r.source_id)}`), sql`, `)})
        `));
        for (const c of calls) {
          const r = shopTs(c.atRaw);
          const e = shopTs(c.atEt);
          if (r && e) callAt.set(String(c.vapiCallId), { raw: r, et: e });
        }
      } catch (err) {
        log.warn("[opportunity-queue] missed-call call-time read failed (anchoring on created_at)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const live = liveRaw.flatMap((r) => {
        const fallback = { raw: shopTs(r.createdRaw), et: shopTs(r.createdEt) };
        const at = callAt.get(String(r.source_id)) ?? fallback;
        // No readable anchor → no decision for this row (never a false closure).
        if (!at.raw || !at.et) return [];
        return [{
          id: String(r.id),
          state: String(r.state) as OpportunityState,
          phone: r.customer_phone == null ? null : String(r.customer_phone),
          anchorRaw: at.raw,
          anchorAt: at.et,
        }];
      });
      const phones = Array.from(new Set(live.map((r) => phone10(r.phone)).filter((p): p is string => p != null)));

      const evidence: MissedCallServedEvidence[] = [];
      if (phones.length > 0 && live.length > 0) {
        // Stored-value bound; the exact strictly-after / same-day decision is
        // made in decideMissedCallServed on the shop-time strings.
        const since = live.map((r) => r.anchorRaw).sort()[0];
        const inPhones = (col: ReturnType<typeof sql.raw>) =>
          sql`RIGHT(REGEXP_REPLACE(${col}, '[^0-9]', ''), 10) IN (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})`;
        const sources: Array<{ source: MissedCallEvidenceSource; query: ReturnType<typeof sql> }> = [
          // PAID only: a `pending` invoice is an open ALG ticket, not a served customer.
          { source: "invoices", query: sql`
            SELECT id, customerPhone AS phone, ${et("invoiceDate")} AS at FROM invoices
            WHERE invoiceDate >= DATE_SUB(${since}, INTERVAL 1 DAY) AND paymentStatus = 'paid'
              AND customerPhone IS NOT NULL AND ${inPhones(sql.raw("customerPhone"))}
            ORDER BY invoiceDate ASC LIMIT 1000` },
          { source: "callback_requests", query: sql`
            SELECT id, phone, ${et("createdAt")} AS at FROM callback_requests
            WHERE createdAt > ${since} AND ${inPhones(sql.raw("phone"))}
            ORDER BY createdAt ASC LIMIT 1000` },
          { source: "leads", query: sql`
            SELECT id, phone, ${et("createdAt")} AS at FROM leads
            WHERE createdAt > ${since} AND phone IS NOT NULL AND ${inPhones(sql.raw("phone"))}
            ORDER BY createdAt ASC LIMIT 1000` },
          { source: "bookings", query: sql`
            SELECT id, phone, ${et("createdAt")} AS at FROM bookings
            WHERE createdAt > ${since} AND phone IS NOT NULL AND ${inPhones(sql.raw("phone"))}
            ORDER BY createdAt ASC LIMIT 1000` },
          { source: "vapi_call_logs", query: sql`
            SELECT id, phoneNumber AS phone, ${et("createdAt")} AS at, leadId, callbackId FROM vapi_call_logs
            WHERE createdAt > ${since} AND (leadId IS NOT NULL OR callbackId IS NOT NULL)
              AND phoneNumber IS NOT NULL AND ${inPhones(sql.raw("phoneNumber"))}
            ORDER BY createdAt ASC LIMIT 1000` },
        ];
        for (const s of sources) {
          try {
            for (const e of rowsFromExecute(await db.execute(s.query))) {
              const at = shopTs(e.at);
              if (!at) continue;
              const detail = s.source === "vapi_call_logs"
                ? [e.leadId != null ? `lead #${Number(e.leadId)}` : "", e.callbackId != null ? `callback #${Number(e.callbackId)}` : ""]
                    .filter(Boolean).join(", ")
                : undefined;
              evidence.push({
                source: s.source,
                id: Number(e.id),
                phone: e.phone == null ? null : String(e.phone),
                at,
                ...(detail ? { detail } : {}),
              });
            }
          } catch (err) {
            if (!isMissingTableError(err) && !isUnknownColumnError(err)) {
              log.warn("[opportunity-queue] missed-call served-evidence read failed", {
                source: s.source,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }

      const closedIds = new Set<string>();
      for (const r of live) {
        const { invoice, served } = decideMissedCallServed({ phone: r.phone, anchorAt: r.anchorAt, evidence });
        if (!invoice && !served) continue;
        stats.checked++;
        if (invoice) {
          const res = await recordOutcome({ id: r.id, invoiceId: invoice.id, by: "reconciler" });
          if (res.ok) {
            stats.won++;
            closedIds.add(r.id);
            continue;
          }
        }
        const servedTo = served ? servedCloseState(r.state) : null;
        if (served && servedTo) {
          const res = await transitionOpportunity({
            id: r.id,
            to: servedTo,
            by: "reconciler",
            note: missedCallServedNote(served),
          });
          if (res.ok) {
            stats.closed++;
            closedIds.add(r.id);
          }
        }
      }

      const plan = planMissedCallCollapse(live.filter((r) => !closedIds.has(r.id)));
      for (const c of plan.collapse) {
        stats.checked++;
        const res = await transitionOpportunity({
          id: c.id,
          to: "duplicate",
          by: "reconciler",
          note: `collapsed into ${c.keepId} (same phone, newer missed call)`,
        });
        if (res.ok) stats.closed++;
      }
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] missed-call served/collapse reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. missed_call: a week-old missed call is not an actionable owner
  //    decision anymore — age it out instead of letting it pin the inbox.
  //    LIMIT raised 100 → 500 (2026-10-02) so an accumulated backlog drains
  //    in one pass instead of 100 rows per run.
  try {
    const stale = rowsFromExecute(await db.execute(sql`
      SELECT id FROM revenue_opportunities
      WHERE source_type = 'missed_call'
        AND state IN (${stateList})
        AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
      LIMIT 500
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
  //    non-declined decision, or verified completed work (0143) → the
  //    deferral resolved (the customer engaged; approved or finished work
  //    is active business, not a chase). The verifiedAt clause is tried
  //    first and dropped on a pre-0143 database.
  try {
    const resolvedQuery = (withVerified: boolean) => sql`
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
            ${withVerified ? sql`AND i.verifiedAt IS NULL` : sql``}
        )
      LIMIT 100
    `;
    let resolved: Array<Record<string, unknown>>;
    try {
      resolved = rowsFromExecute(await db.execute(resolvedQuery(true)));
    } catch (err) {
      if (!isUnknownColumnError(err)) throw err;
      resolved = rowsFromExecute(await db.execute(resolvedQuery(false)));
    }
    stats.checked += resolved.length;
    for (const r of resolved) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: "source resolved: every flagged inspection item now has a customer decision or verified completed work",
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isMissingTableError(err) && !isUnknownColumnError(err)) {
      log.warn("[opportunity-queue] deferral reconciler failed", { error: msg });
    }
  }

  // 5. stale_lead: (a) the lead was handled outside the queue (contacted
  //    flag / status moved) → close our copy; (b) the lead crossed 30 days
  //    → age out (mission rule: >30d is archive territory, not a chase).
  //    Both are queue-side only — lead rows are protected persistence and
  //    are never mutated from here.
  try {
    const handled = rowsFromExecute(await db.execute(sql`
      SELECT o.id, l.status AS leadStatus, l.contacted AS contacted
      FROM revenue_opportunities o
      JOIN leads l ON l.id = CAST(o.source_id AS UNSIGNED)
      WHERE o.source_type = 'stale_lead'
        AND o.state IN (${stateList})
        AND (l.contacted = 1 OR l.status != 'new')
      LIMIT 100
    `));
    stats.checked += handled.length;
    for (const r of handled) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: `source resolved: lead ${Number(r.contacted) === 1 ? "contacted" : `status=${String(r.leadStatus)}`} (handled outside the queue)`,
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] stale-lead-handled reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  try {
    const aged = rowsFromExecute(await db.execute(sql`
      SELECT o.id
      FROM revenue_opportunities o
      JOIN leads l ON l.id = CAST(o.source_id AS UNSIGNED)
      WHERE o.source_type = 'stale_lead'
        AND o.state IN (${stateList})
        AND l.createdAt < DATE_SUB(NOW(), INTERVAL 30 DAY)
      LIMIT 100
    `));
    stats.checked += aged.length;
    for (const r of aged) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: "aged out: lead older than 30 days (archive — reopen only on a fresh signal)",
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] stale-lead-aging reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 6. no_show_booking: the booking left new/confirmed (completed or
  //    cancelled) → the loop closed itself; drop our copy.
  try {
    const resolved = rowsFromExecute(await db.execute(sql`
      SELECT o.id, b.status AS bStatus
      FROM revenue_opportunities o
      JOIN bookings b ON b.id = CAST(o.source_id AS UNSIGNED)
      WHERE o.source_type = 'no_show_booking'
        AND o.state IN (${stateList})
        AND b.status NOT IN ('new', 'confirmed')
      LIMIT 100
    `));
    stats.checked += resolved.length;
    for (const r of resolved) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: `source resolved: booking status=${String(r.bStatus)}`,
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] no-show reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 7. human_pending_sms: the response job left human_pending (someone
  //    answered, or it was closed as no-reply-needed) → close our copy.
  try {
    const answered = rowsFromExecute(await db.execute(sql`
      SELECT o.id, j.status AS jStatus
      FROM revenue_opportunities o
      JOIN sms_response_jobs j ON j.id = CAST(o.source_id AS UNSIGNED)
      WHERE o.source_type = 'human_pending_sms'
        AND o.state IN (${stateList})
        AND j.status != 'human_pending'
      LIMIT 100
    `));
    stats.checked += answered.length;
    for (const r of answered) {
      const res = await transitionOpportunity({
        id: String(r.id),
        to: "lost",
        by: "reconciler",
        note: `source resolved: response job status=${String(r.jStatus)} (conversation handled)`,
      });
      if (res.ok) stats.closed++;
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] human-pending reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 8. abandoned_form: a lead or booking appeared for the same phone after
  //    the abandonment → they converted; close our copy. Aged >14d closes
  //    too. String sessionId join (no CAST — the source PK is a varchar).
  //    Runtime-truth-pass fix (2026-07-29): the converted-check moved from
  //    correlated EXISTS with REPLACE()-chained join keys (unindexable —
  //    stalled a live refresh 20+ min) to fetch-once + JS filter, mirroring
  //    the collector.
  try {
    const live = rowsFromExecute(await db.execute(sql`
      SELECT o.id, a.phone AS formPhone, a.createdAt AS abandonedAt
      FROM revenue_opportunities o
      JOIN abandoned_forms a ON a.sessionId = o.source_id
      WHERE o.source_type = 'abandoned_form'
        AND o.state IN (${stateList})
      LIMIT 100
    `));
    if (live.length > 0) {
      const converted = new Map<string, number>();
      const [leadRows] = await db.execute(sql`
        SELECT phone, createdAt FROM leads
        WHERE phone IS NOT NULL AND createdAt > DATE_SUB(NOW(), INTERVAL 15 DAY)
        LIMIT 500
      `);
      const [bookingRows] = await db.execute(sql`
        SELECT phone, createdAt FROM bookings
        WHERE phone IS NOT NULL AND createdAt > DATE_SUB(NOW(), INTERVAL 15 DAY)
        LIMIT 500
      `);
      for (const r of [...(Array.isArray(leadRows) ? leadRows : []), ...(Array.isArray(bookingRows) ? bookingRows : [])]) {
        const row = r as { phone?: unknown; createdAt?: unknown };
        const p = String(row.phone ?? "").replace(/\D/g, "").slice(-10);
        if (p.length !== 10) continue;
        const ts = new Date(String(row.createdAt)).getTime();
        const prev = converted.get(p);
        if (prev === undefined || ts < prev) converted.set(p, ts);
      }
      const cutoff14d = Date.now() - 14 * 86_400_000;
      for (const r of live) {
        const p = String(r.formPhone ?? "").replace(/\D/g, "").slice(-10);
        const abandonedAt = new Date(String(r.abandonedAt)).getTime();
        const convertedAt = converted.get(p);
        const didConvert = convertedAt !== undefined && convertedAt >= abandonedAt;
        const aged = abandonedAt < cutoff14d;
        if (!didConvert && !aged) continue;
        stats.checked++;
        const res = await transitionOpportunity({
          id: String(r.id),
          to: "lost",
          by: "reconciler",
          note: didConvert
            ? "source resolved: subsequent lead/booking appeared for this phone"
            : "aged out: partial older than 14 days",
        });
        if (res.ok) stats.closed++;
      }
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      log.warn("[opportunity-queue] abandoned-form reconciler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
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
  const staleLeads = await collectStaleLeads();
  const noShows = await collectNoShowBookings();
  const humanPending = await collectOverdueHumanPending();
  const abandonedFormsStats = await collectAbandonedForms();
  const fmt = (s: CollectorStats) => `${s.inserted}new/${s.refreshed}ref/${s.scanned}scan`;
  let details =
    `reconciled: ${reconciled.won}won+${reconciled.closed}closed/${reconciled.checked} · ` +
    `estimates: ${fmt(estimates)} · callbacks: ${fmt(callbacks)} · ` +
    `missed calls: ${fmt(missedCalls)}/${missedCalls.collapsed}collapsed · deferrals: ${fmt(inspections)} · ` +
    `stale leads: ${fmt(staleLeads)} · no-shows: ${fmt(noShows)} · ` +
    `waiting texts: ${fmt(humanPending)} · abandoned forms: ${fmt(abandonedFormsStats)}`;
  const recordsProcessed =
    reconciled.won + reconciled.closed +
    estimates.inserted + callbacks.inserted + missedCalls.inserted + missedCalls.collapsed + inspections.inserted +
    staleLeads.inserted + noShows.inserted + humanPending.inserted + abandonedFormsStats.inserted;

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
