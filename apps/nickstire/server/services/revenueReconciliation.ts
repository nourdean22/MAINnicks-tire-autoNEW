import { randomUUID } from "crypto";
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { bookings, invoices, leads, vapiCallLogs } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  ATTRIBUTION_DEFINITION_VERSION,
  buildCallInvoiceCandidates,
  type CallObservation,
  type LeadLinkObservation,
  type PaidInvoiceObservation,
} from "./revenueAttribution";
import {
  buildVapiMeasurementRecord,
  deriveVapiFacts,
  VAPI_QUALITY_VERSION,
} from "./vapiMeasurement";

export const RECONCILIATION_DEFINITION_VERSION = "revenue-reconciliation-v1";
export const LEGACY_BACKFILL_DEFINITION_VERSION = "vapi-legacy-backfill-v1";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rowsFromExecute<T>(value: unknown): T[] {
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0] as T[];
  if (Array.isArray(value)) return value as T[];
  return [];
}

export interface ReconciliationInput {
  since: Date;
  until: Date;
  maxDays?: number;
}

export async function runRevenueReconciliation(input: ReconciliationInput) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const runId = randomUUID();
  const maxDays = input.maxDays ?? 14;
  const invoiceUntil = new Date(input.until.getTime() + maxDays * 86_400_000);

  await db.execute(sql`
    INSERT INTO revenue_reconciliation_runs
      (id, definition_version, status, window_start, window_end, max_days)
    VALUES
      (${runId}, ${RECONCILIATION_DEFINITION_VERSION}, 'running', ${input.since}, ${input.until}, ${maxDays})
  `);

  try {
    const [callRows, invoiceRows, leadRows, currentDecisionRaw] = await Promise.all([
      db.select({
        callId: vapiCallLogs.id,
        phoneNumber: vapiCallLogs.phoneNumber,
        leadId: vapiCallLogs.leadId,
        serviceMention: vapiCallLogs.serviceMention,
        occurredAt: vapiCallLogs.createdAt,
      }).from(vapiCallLogs).where(and(
        gte(vapiCallLogs.createdAt, input.since),
        lte(vapiCallLogs.createdAt, input.until),
      )),
      db.select({
        invoiceId: invoices.id,
        customerPhone: invoices.customerPhone,
        customerId: invoices.customerId,
        serviceDescription: invoices.serviceDescription,
        paidAt: invoices.invoiceDate,
        amountCents: invoices.totalAmount,
      }).from(invoices).where(and(
        eq(invoices.paymentStatus, "paid"),
        gte(invoices.invoiceDate, input.since),
        lte(invoices.invoiceDate, invoiceUntil),
      )),
      db.select({
        leadId: leads.id,
        invoiceId: leads.invoiceId,
        bookingId: leads.bookingId,
      }).from(leads),
      db.execute(sql`
        SELECT call_id AS callId
        FROM revenue_attribution_decisions
        WHERE current_slot = 1
      `),
    ]);

    const currentDecisions = new Set(
      rowsFromExecute<{ callId: number }>(currentDecisionRaw).map((row) => Number(row.callId)),
    );
    const leadById = new Map(leadRows.map((row) => [row.leadId, row]));
    const callById = new Map(callRows.map((row) => [row.callId, row]));
    const candidates = buildCallInvoiceCandidates({
      calls: callRows as CallObservation[],
      paidInvoices: invoiceRows as PaidInvoiceObservation[],
      leadLinks: leadRows as LeadLinkObservation[],
      maxDays,
    });

    let preserved = 0;
    let verified = 0;
    let inferred = 0;
    let ambiguous = 0;
    let unmatched = 0;

    for (const candidate of candidates) {
      if (currentDecisions.has(candidate.callId)) {
        preserved += 1;
        continue;
      }

      const call = callById.get(candidate.callId);
      const lead = call?.leadId == null ? null : leadById.get(call.leadId) ?? null;
      if (candidate.resolution === "attributed") verified += 1;
      else if (candidate.resolution === "manual_review") inferred += 1;
      else if (candidate.resolution === "ambiguous") ambiguous += 1;
      else unmatched += 1;

      const matchMethod = candidate.resolution === "attributed"
        ? "direct_call_lead_invoice"
        : candidate.resolution === "manual_review"
          ? "phone_time_service_candidate"
          : candidate.resolution === "ambiguous"
            ? "multiple_plausible_invoices"
            : "no_supported_match";

      await db.execute(sql`
        INSERT IGNORE INTO revenue_reconciliation_candidates
          (id, run_id, call_id, lead_id, booking_id, invoice_id, work_order_id,
           resolution, evidence_level, match_method, confidence, evidence_json)
        VALUES
          (${randomUUID()}, ${runId}, ${candidate.callId}, ${call?.leadId ?? null},
           ${lead?.bookingId ?? null}, ${candidate.invoiceId}, NULL,
           ${candidate.resolution}, ${candidate.evidenceLevel}, ${matchMethod},
           ${candidate.confidence}, ${JSON.stringify({ reasons: candidate.reasons })})
      `);
    }

    await db.execute(sql`
      UPDATE revenue_reconciliation_runs SET
        status = 'completed',
        calls_scanned = ${callRows.length},
        verified_candidates = ${verified},
        inferred_candidates = ${inferred},
        ambiguous_candidates = ${ambiguous},
        unmatched_candidates = ${unmatched},
        decisions_preserved = ${preserved},
        completed_at = NOW()
      WHERE id = ${runId}
    `);

    return {
      runId,
      definitionVersion: RECONCILIATION_DEFINITION_VERSION,
      callsScanned: callRows.length,
      verified,
      inferred,
      ambiguous,
      unmatched,
      decisionsPreserved: preserved,
    };
  } catch (error) {
    await db.execute(sql`
      UPDATE revenue_reconciliation_runs SET
        status = 'failed',
        error_text = ${error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000)},
        completed_at = NOW()
      WHERE id = ${runId}
    `).catch(() => undefined);
    throw error;
  }
}

export async function resolveAttributionDecision(input: {
  callId: number;
  leadId?: number | null;
  bookingId?: number | null;
  invoiceId?: number | null;
  workOrderId?: string | null;
  decision: "confirmed" | "rejected" | "ambiguous";
  evidenceLevel: "observed" | "inferred" | "verified";
  matchMethod: string;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
  decidedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const existingRaw = await db.execute(sql`
    SELECT id
    FROM revenue_attribution_decisions
    WHERE call_id = ${input.callId} AND current_slot = 1
    LIMIT 1
  `);
  const existing = rowsFromExecute<{ id: string }>(existingRaw)[0] ?? null;
  const id = randomUUID();

  if (existing) {
    await db.execute(sql`
      UPDATE revenue_attribution_decisions
      SET current_slot = NULL
      WHERE id = ${existing.id} AND current_slot = 1
    `);
  }

  await db.execute(sql`
    INSERT INTO revenue_attribution_decisions
      (id, call_id, lead_id, booking_id, invoice_id, work_order_id, decision,
       evidence_level, match_method, confidence, evidence_json, decided_by,
       supersedes_decision_id, current_slot)
    VALUES
      (${id}, ${input.callId}, ${input.leadId ?? null}, ${input.bookingId ?? null},
       ${input.invoiceId ?? null}, ${input.workOrderId ?? null}, ${input.decision},
       ${input.evidenceLevel}, ${input.matchMethod}, ${input.confidence ?? null},
       ${JSON.stringify(input.evidence ?? {})}, ${input.decidedBy}, ${existing?.id ?? null}, 1)
  `);

  return { id, supersedesDecisionId: existing?.id ?? null };
}

export async function getRevenueJourney(callId: number) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const raw = await db.execute(sql`
    SELECT
      c.id AS callId,
      c.leadId AS leadId,
      l.bookingId AS bookingId,
      l.invoiceId AS invoiceId,
      b.confirmedAt AS bookingConfirmedAt,
      b.status AS bookingStatus,
      i.paymentStatus AS invoiceStatus,
      i.totalAmount AS invoiceAmountCents,
      i.invoiceDate AS invoiceDate,
      d.id AS decisionId,
      d.decision,
      d.evidence_level AS evidenceLevel,
      d.match_method AS matchMethod,
      d.work_order_id AS workOrderId,
      d.decided_at AS decidedAt
    FROM vapi_call_logs c
    LEFT JOIN leads l ON l.id = c.leadId
    LEFT JOIN bookings b ON b.id = l.bookingId
    LEFT JOIN invoices i ON i.id = l.invoiceId
    LEFT JOIN revenue_attribution_decisions d
      ON d.call_id = c.id AND d.current_slot = 1
    WHERE c.id = ${callId}
    LIMIT 1
  `);
  const row = rowsFromExecute<Record<string, unknown>>(raw)[0] ?? null;
  if (!row) return null;

  return {
    ...row,
    stages: {
      call: "observed",
      lead: row.leadId ? "verified" : "unavailable",
      booking: row.bookingId ? "verified" : "unavailable",
      arrival: row.workOrderId ? "verified" : "not_connected",
      repairOrder: row.workOrderId ? "verified" : "not_connected",
      paidInvoice: row.invoiceId && row.invoiceStatus === "paid" ? "verified" : "unavailable",
    },
    limitations: [
      "Booking confirmation is not treated as vehicle arrival.",
      "Arrival and repair-order stages remain not connected unless a reviewed work-order identifier is present.",
    ],
  };
}

export async function runLegacyVapiBackfill(input: {
  since: Date;
  until: Date;
  mode: "dry_run" | "apply";
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const runId = randomUUID();

  await db.execute(sql`
    INSERT INTO vapi_legacy_backfill_runs
      (id, definition_version, mode, status, window_start, window_end)
    VALUES
      (${runId}, ${LEGACY_BACKFILL_DEFINITION_VERSION}, ${input.mode}, 'running', ${input.since}, ${input.until})
  `);

  try {
    const rows = await db.select({
      id: vapiCallLogs.id,
      leadId: vapiCallLogs.leadId,
      callbackId: vapiCallLogs.callbackId,
      endedReason: vapiCallLogs.endedReason,
      evalOutcome: vapiCallLogs.evalOutcome,
      evalScore: vapiCallLogs.evalScore,
      evalAt: vapiCallLogs.evalAt,
      metadata: vapiCallLogs.metadata,
    }).from(vapiCallLogs).where(and(
      gte(vapiCallLogs.createdAt, input.since),
      lte(vapiCallLogs.createdAt, input.until),
      isNotNull(vapiCallLogs.evalAt),
    ));

    let eligible = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const metadata = asRecord(row.metadata);
      if (metadata.revenueOpsV1) {
        skipped += 1;
        continue;
      }
      if (!row.evalOutcome) {
        skipped += 1;
        continue;
      }

      eligible += 1;
      if (input.mode === "dry_run") continue;

      const facts = deriveVapiFacts({
        reachedTool: false,
        leadId: row.leadId,
        callbackId: row.callbackId,
        endedReason: row.endedReason,
        inferredWalkIn: row.evalOutcome === "walk_in_directed",
      });
      const measurement = buildVapiMeasurementRecord({
        facts,
        quality: {
          score: row.evalScore,
          version: VAPI_QUALITY_VERSION,
          evidence: ["legacy stored evaluation"],
          ...(row.evalScore == null ? { unavailableReason: row.evalOutcome } : {}),
        },
        walkInEvidence: row.evalOutcome === "walk_in_directed" ? "inferred" : "observed",
      });

      await db.update(vapiCallLogs).set({
        metadata: {
          ...metadata,
          revenueOpsV1: {
            ...measurement,
            backfillVersion: LEGACY_BACKFILL_DEFINITION_VERSION,
            backfilledAt: new Date().toISOString(),
            sourceLimitation: "Reconstructed from stored evaluation fields; provider transcript was not refetched.",
          },
        },
      }).where(eq(vapiCallLogs.id, row.id));
      updated += 1;
    }

    await db.execute(sql`
      UPDATE vapi_legacy_backfill_runs SET
        status = 'completed',
        rows_scanned = ${rows.length},
        rows_eligible = ${eligible},
        rows_updated = ${updated},
        rows_skipped = ${skipped},
        completed_at = NOW()
      WHERE id = ${runId}
    `);

    return { runId, mode: input.mode, scanned: rows.length, eligible, updated, skipped };
  } catch (error) {
    await db.execute(sql`
      UPDATE vapi_legacy_backfill_runs SET
        status = 'failed',
        error_text = ${error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000)},
        completed_at = NOW()
      WHERE id = ${runId}
    `).catch(() => undefined);
    throw error;
  }
}
