import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { expectedArrivals, invoices, leads, vapiCallLogs } from "../../drizzle/schema";
import { getDbTyped } from "../db";
import { attributionObligationSubject } from "./bridgeKeys";
import {
  autoConfirmCalibrated,
  loadCalibration,
  type AutoConfirmCandidate,
  type AutoConfirmResult,
  type CalibrationState,
} from "./attributionAutoConfirm";
import {
  ATTRIBUTION_DEFINITION_VERSION,
  buildCallInvoiceCandidates,
  type CallObservation,
  type LeadLinkObservation,
  type PaidInvoiceObservation,
} from "./revenueAttribution";
const log = createLogger("revenue-reconciliation");

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
  const db = await getDbTyped();
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
    const [callRows, invoiceRows, leadRows, arrivalRows, currentDecisionRaw] = await Promise.all([
      db.select({
        callId: vapiCallLogs.id,
        vapiCallId: vapiCallLogs.vapiCallId,
        phoneNumber: vapiCallLogs.phoneNumber,
        leadId: vapiCallLogs.leadId,
        serviceMention: vapiCallLogs.serviceMention,
        metadata: vapiCallLogs.metadata,
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
      db.select({
        id: expectedArrivals.id,
        sourceRef: expectedArrivals.sourceRef,
        status: expectedArrivals.status,
        reconciledInvoiceId: expectedArrivals.reconciledInvoiceId,
        expectedDate: expectedArrivals.expectedDate,
        arrivedAt: expectedArrivals.arrivedAt,
      }).from(expectedArrivals).where(and(
        eq(expectedArrivals.source, "voice"),
        gte(expectedArrivals.createdAt, input.since),
        lte(expectedArrivals.createdAt, invoiceUntil),
      )),
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
    const arrivalsByVapiCallId = new Map<string, typeof arrivalRows>();
    for (const row of arrivalRows) {
      if (!row.sourceRef) continue;
      const key = String(row.sourceRef);
      const rows = arrivalsByVapiCallId.get(key) ?? [];
      rows.push(row);
      arrivalsByVapiCallId.set(key, rows);
    }
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
    const ambiguousCallIds: number[] = [];
    const autoCandidates: AutoConfirmCandidate[] = [];

    for (const candidate of candidates) {
      if (currentDecisions.has(candidate.callId)) {
        preserved += 1;
        continue;
      }

      const call = callById.get(candidate.callId);
      const lead = call?.leadId == null ? null : leadById.get(call.leadId) ?? null;
      const callMetadata = asRecord(call?.metadata);
      const behavior = asRecord(callMetadata.behavior);
      const arrivals = call?.vapiCallId ? arrivalsByVapiCallId.get(call.vapiCallId) ?? [] : [];
      // A model can fire bookSlot more than once. Prefer the receipt that
      // reconciles to THIS revenue candidate; otherwise preserve the strongest
      // other arrival evidence without implying the two invoices are the same.
      const arrival = (
        arrivals.find((row) =>
          row.reconciledInvoiceId != null &&
          candidate.invoiceId != null &&
          Number(row.reconciledInvoiceId) === Number(candidate.invoiceId)
        ) ??
        arrivals.find((row) => row.status === "arrived" && row.reconciledInvoiceId != null) ??
        arrivals[0] ??
        null
      );
      const sameCandidateInvoice = Boolean(
        arrival?.reconciledInvoiceId != null &&
        candidate.invoiceId != null &&
        Number(arrival.reconciledInvoiceId) === Number(candidate.invoiceId)
      );
      const arrivalEvidence = arrival ? {
        source: "expected_arrivals",
        link: "sourceRef=vapiCallId",
        status: arrival.status,
        reconciledInvoiceId: arrival.reconciledInvoiceId,
        expectedDate: arrival.expectedDate,
        arrivedAt: arrival.arrivedAt,
        relationshipToRevenueCandidate: sameCandidateInvoice
          ? "same_candidate_invoice"
          : arrival.reconciledInvoiceId != null
            ? "different_invoice"
            : "no_invoice_yet",
        evidenceLevel: sameCandidateInvoice && arrival.status === "arrived"
          ? "reconciled_same_invoice"
          : arrival.status === "arrived" && arrival.reconciledInvoiceId != null
            ? "reconciled_other_invoice"
            : "observed_intent",
      } : null;
      if (candidate.resolution === "attributed") verified += 1;
      else if (candidate.resolution === "manual_review") inferred += 1;
      else if (candidate.resolution === "ambiguous") {
        ambiguous += 1;
        ambiguousCallIds.push(candidate.callId);
      } else unmatched += 1;

      const matchMethod = candidate.resolution === "attributed"
        ? "direct_call_lead_invoice"
        : candidate.resolution === "manual_review"
          ? "phone_time_service_candidate"
          : candidate.resolution === "ambiguous"
            ? "multiple_plausible_invoices"
            : "no_supported_match";
      if (candidate.resolution === "manual_review" && call) {
        autoCandidates.push({
          callId: candidate.callId,
          invoiceId: candidate.invoiceId,
          resolution: candidate.resolution,
          confidence: candidate.confidence,
          matchMethod,
          leadId: call.leadId ?? null,
          bookingId: lead?.bookingId ?? null,
          occurredAt: call.occurredAt,
        });
      }

      await db.execute(sql`
        INSERT IGNORE INTO revenue_reconciliation_candidates
          (id, run_id, call_id, lead_id, booking_id, invoice_id, work_order_id,
           resolution, evidence_level, match_method, confidence, evidence_json)
        VALUES
          (${randomUUID()}, ${runId}, ${candidate.callId}, ${call?.leadId ?? null},
           ${lead?.bookingId ?? null}, ${candidate.invoiceId}, NULL,
           ${candidate.resolution}, ${candidate.evidenceLevel}, ${matchMethod},
           ${candidate.confidence}, ${JSON.stringify({
             reasons: candidate.reasons,
             ...(behavior.hash ? { behavior } : {}),
             ...(arrivalEvidence ? { arrival: arrivalEvidence } : {}),
           })})
      `);
    }

    // Self-learning step (2026-10-25): a band that has earned it (measured right rate >= 90%
    // over at least 20 rulings and recorded links) confirms its own weak matches, one ruling
    // per invoice. A calibration read that fails is a CLOSED gate and is said so on the run.
    let calibration: CalibrationState;
    try {
      calibration = await loadCalibration(db);
    } catch (e) {
      calibration = { status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300) };
      log.warn("[revenueReconciliation] calibration read failed; no auto-confirm this run", { error: calibration.error });
    }
    const autoConfirm: AutoConfirmResult = await autoConfirmCalibrated(db, { runId, candidates: autoCandidates, calibration });

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

    // Owner escalation contract (artifact 4 §3.2): weak matches are a human
    // ruling waiting to happen, and the ruling had no door until the
    // Attribution review card. One obligation per run, never per row, and
    // never a customer name — the links are the evidence.
    if (ambiguous > 0) {
      try {
        const { escalateToOwner } = await import("./ownerEscalation");
        escalateToOwner({
          trigger: "attribution_weak_matches",
          summary: `Revenue reconciliation run #${runId} left ${ambiguous} call↔invoice match${ambiguous === 1 ? "" : "es"} ambiguous (${verified} verified, ${inferred} inferred, ${unmatched} unmatched).`,
          // No count in the title: the one open task outlives many runs, and the
          // live count is on the Attribution review card.
          decisionRequested: "Rule on ambiguous call↔invoice matches",
          consequence: "Until ruled, these calls carry no revenue attribution and the voice scorecard under-counts.",
          deadline: null,
          evidenceLinks: ["/admin?tab=voiceReceptionist"],
          authorization: { tier: 1, role: "manager" },
          writeBack: "revenueAttribution.resolve (Attribution review card → Confirm / Unsure / Reject)",
          priority: "medium",
          // The obligation is the SET of unruled calls, not the run: the job
          // re-runs every 2 h over a rolling 21-day window, and each run used to
          // open a fresh StateNour task for the same unchanged set (ADR-0019 §2.1).
          // A new ambiguous call, or a ruling that shrinks the set, is a new fact.
          subjectId: attributionObligationSubject(ambiguousCallIds),
          standing: true,
        });
      } catch (e) {
        log.warn("[revenueReconciliation] escalation failed (run result unaffected)", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      runId,
      definitionVersion: RECONCILIATION_DEFINITION_VERSION,
      callsScanned: callRows.length,
      verified,
      inferred,
      ambiguous,
      unmatched,
      decisionsPreserved: preserved,
      autoConfirm,
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
  const db = await getDbTyped();
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
