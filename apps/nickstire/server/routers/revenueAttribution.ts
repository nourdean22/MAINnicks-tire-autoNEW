import { and, eq, gte, lte, sql } from "drizzle-orm";
import { collapseByInvoice, attributionCounts } from "../lib/attributionDedupe";
import { BAND_CALIBRATION_CAVEAT, bandMix } from "../lib/attributionConfidenceBands";
import { z } from "zod";
import { invoices, leads, vapiCallLogs } from "../../drizzle/schema";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  aggregateVerifiedLeadRevenue,
  buildCallInvoiceCandidates,
  type CallObservation,
  type LeadInvoiceRow,
  type LeadLinkObservation,
  type PaidInvoiceObservation,
} from "../services/revenueAttribution";
import {
  getRevenueJourney,
  resolveAttributionDecision,
  runLegacyVapiBackfill,
  runRevenueReconciliation,
} from "../services/revenueReconciliation";

const dateRangeSchema = z.object({
  sinceISO: z.string().datetime(),
  untilISO: z.string().datetime().optional(),
});

function rowsFromExecute<T>(value: unknown): T[] {
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0] as T[];
  if (Array.isArray(value)) return value as T[];
  return [];
}

export const revenueAttributionRouter = router({
  leadRevenueSummary: adminProcedure.input(dateRangeSchema).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const since = new Date(input.sinceISO);
    const until = input.untilISO ? new Date(input.untilISO) : new Date();
    const rows = await db.select({
      leadId: leads.id,
      source: leads.source,
      utmSource: leads.utmSource,
      invoiceId: leads.invoiceId,
      invoiceStatus: invoices.paymentStatus,
      invoiceAmountCents: invoices.totalAmount,
    })
      .from(leads)
      .leftJoin(invoices, eq(leads.invoiceId, invoices.id))
      .where(and(
        gte(leads.createdAt, since),
        lte(leads.createdAt, until),
      ));

    const summary = aggregateVerifiedLeadRevenue(rows as LeadInvoiceRow[]);
    return {
      window: {
        sinceISO: input.sinceISO,
        untilISO: input.untilISO ?? null,
        timeZone: "America/New_York" as const,
      },
      source: "leads.invoiceId -> invoices.id" as const,
      generatedAt: new Date().toISOString(),
      ...summary,
    };
  }),

  callInvoiceReview: adminProcedure.input(dateRangeSchema.extend({
    maxDays: z.number().int().min(1).max(30).default(14),
  })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");

    const since = new Date(input.sinceISO);
    const until = input.untilISO ? new Date(input.untilISO) : new Date();
    const invoiceUntil = new Date(until.getTime() + input.maxDays * 86_400_000);

    const [callRows, invoiceRows, leadRows] = await Promise.all([
      db.select({
        callId: vapiCallLogs.id,
        phoneNumber: vapiCallLogs.phoneNumber,
        leadId: vapiCallLogs.leadId,
        serviceMention: vapiCallLogs.serviceMention,
        occurredAt: vapiCallLogs.createdAt,
      }).from(vapiCallLogs).where(and(
        gte(vapiCallLogs.createdAt, since),
        lte(vapiCallLogs.createdAt, until),
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
        gte(invoices.invoiceDate, since),
        lte(invoices.invoiceDate, invoiceUntil),
      )),
      db.select({
        leadId: leads.id,
        invoiceId: leads.invoiceId,
      }).from(leads),
    ]);

    const candidates = buildCallInvoiceCandidates({
      calls: callRows as CallObservation[],
      paidInvoices: invoiceRows as PaidInvoiceObservation[],
      leadLinks: leadRows as LeadLinkObservation[],
      maxDays: input.maxDays,
    });

    const counts = candidates.reduce((acc, candidate) => {
      acc[candidate.resolution] += 1;
      return acc;
    }, {
      attributed: 0,
      manual_review: 0,
      unmatched: 0,
      ambiguous: 0,
    });

    return {
      metricDefinitionVersion: "revenue-attribution-v1" as const,
      window: {
        sinceISO: input.sinceISO,
        untilISO: input.untilISO ?? null,
        maxDays: input.maxDays,
        timeZone: "America/New_York" as const,
      },
      generatedAt: new Date().toISOString(),
      counts,
      candidates,
      limitations: [
        "Only direct call-to-lead-to-paid-invoice linkage is verified automatically.",
        "Phone, time, and service similarity remain inferred and require manual review.",
      ],
    };
  }),

  reconciliationRuns: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(20) })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const raw = await db.execute(sql`
      SELECT * FROM revenue_reconciliation_runs
      ORDER BY started_at DESC
      LIMIT ${input.limit}
    `);
    return rowsFromExecute<Record<string, unknown>>(raw);
  }),

  reviewQueue: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(50) })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const raw = await db.execute(sql`
      SELECT
        c.id,
        c.run_id AS runId,
        c.call_id AS callId,
        c.lead_id AS leadId,
        c.booking_id AS bookingId,
        c.invoice_id AS invoiceId,
        c.work_order_id AS workOrderId,
        c.resolution,
        c.evidence_level AS evidenceLevel,
        c.match_method AS matchMethod,
        c.confidence,
        c.evidence_json AS evidence,
        c.created_at AS createdAt
      FROM revenue_reconciliation_candidates c
      INNER JOIN (
        SELECT call_id, MAX(created_at) AS latest_created_at
        FROM revenue_reconciliation_candidates
        GROUP BY call_id
      ) latest
        ON latest.call_id = c.call_id
       AND latest.latest_created_at = c.created_at
      LEFT JOIN revenue_attribution_decisions d
        ON d.call_id = c.call_id AND d.current_slot = 1
      WHERE d.id IS NULL
        AND c.resolution IN ('manual_review', 'ambiguous')
      ORDER BY c.created_at DESC
      LIMIT ${input.limit}
    `);
    const rows = rowsFromExecute<Record<string, unknown>>(raw);

    /**
     * AN INVOICE CAN BE PAID ONCE, SO IT CAN BE CLAIMED ONCE.
     *
     * The query above dedupes by call_id (the latest candidate per call) and
     * NOT by invoice_id. Observed live on 2026-09-18: of twenty weak matches,
     * EIGHT claimed the same invoice #5160005 — one customer who rang eight
     * times before coming in. Each row read "this call produced this invoice",
     * so confirming them all would have counted that invoice eight times.
     *
     * This inflates REVENUE rather than demand, which makes it the more
     * dangerous of the two defects this wave found: it is the number the system
     * is judged by, and nobody audits a number they like.
     *
     * Duplicates are RETAINED and pointed at the primary rather than dropped —
     * those seven calls are real contacts from the same customer. They stop
     * being separate decisions about separate money; they do not stop existing.
     */
    const collapsed = collapseByInvoice(
      rows.map((r) => ({
        ...r,
        id: Number(r.id),
        callId: Number(r.callId),
        invoiceId: r.invoiceId == null ? null : Number(r.invoiceId),
        confidence: r.confidence == null ? null : Number(r.confidence),
        resolution: String(r.resolution ?? ""),
        createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt)),
      })),
    );

    return {
      /** The decisions a human should actually make — one per invoice. */
      rows: collapsed.primary,
      /** Same-invoice contacts, kept for context. NOT independent decisions. */
      duplicates: collapsed.duplicates,
      /** Invoices claimed by more than one call. Non-empty is normal; billing twice is not. */
      contestedInvoiceIds: collapsed.contestedInvoiceIds,
      /**
       * Both counts side by side, so the gap is visible rather than implied.
       * `candidateRows` is what this queue used to return; reporting it as
       * conversions is the over-count.
       */
      counts: attributionCounts(collapsed),
      /**
       * WHAT THE CONFIDENCE NUMBERS ACTUALLY MEAN.
       *
       * The rows carry 0.9 and 0.75 next to real invoices, and an operator
       * confirming money reads those as percentages. They are not: they are
       * ordinal labels for two evidence recipes that differ by exactly one
       * fact — whether the service text overlapped — and neither has ever been
       * calibrated against outcomes.
       *
       * `inferredPct` is the number worth watching. A queue that is mostly
       * inference is a queue where confirming in bulk is guessing in bulk, and
       * the last defect found here was precisely that: eight calls claiming one
       * invoice, each individually plausible.
       */
      bands: bandMix(collapsed.primary.map((r) => r.confidence)),
      bandCaveat: BAND_CALIBRATION_CAVEAT,
    };
  }),

  reconcile: adminProcedure.input(dateRangeSchema.extend({
    maxDays: z.number().int().min(1).max(30).default(14),
  })).mutation(async ({ input }) => runRevenueReconciliation({
    since: new Date(input.sinceISO),
    until: input.untilISO ? new Date(input.untilISO) : new Date(),
    maxDays: input.maxDays,
  })),

  resolve: adminProcedure.input(z.object({
    callId: z.number().int().positive(),
    leadId: z.number().int().positive().nullable().optional(),
    bookingId: z.number().int().positive().nullable().optional(),
    invoiceId: z.number().int().positive().nullable().optional(),
    workOrderId: z.string().max(64).nullable().optional(),
    decision: z.enum(["confirmed", "rejected", "ambiguous"]),
    evidenceLevel: z.enum(["observed", "inferred", "verified"]),
    matchMethod: z.string().min(3).max(64),
    confidence: z.number().min(0).max(1).nullable().optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
  })).mutation(async ({ input, ctx }) => resolveAttributionDecision({
    ...input,
    decidedBy: ctx.user?.email ?? ctx.user?.name ?? "admin",
  })),

  journey: adminProcedure.input(z.object({ callId: z.number().int().positive() })).query(async ({ input }) =>
    getRevenueJourney(input.callId)),

  legacyBackfill: adminProcedure.input(dateRangeSchema.extend({
    mode: z.enum(["dry_run", "apply"]).default("dry_run"),
    confirmation: z.string().optional(),
  })).mutation(async ({ input }) => {
    if (input.mode === "apply" && input.confirmation !== "APPLY_LEGACY_VAPI_BACKFILL") {
      throw new Error("Applying the backfill requires confirmation: APPLY_LEGACY_VAPI_BACKFILL");
    }
    return runLegacyVapiBackfill({
      since: new Date(input.sinceISO),
      until: input.untilISO ? new Date(input.untilISO) : new Date(),
      mode: input.mode,
    });
  }),
});
