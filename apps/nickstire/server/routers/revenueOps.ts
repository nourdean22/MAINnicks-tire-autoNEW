import { and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { vapiCallLogs } from "../../drizzle/schema";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { buildGscMeasurementReport } from "../services/gscMeasurement";

const rangeSchema = z.object({
  sinceISO: z.string().datetime(),
  untilISO: z.string().datetime().optional(),
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export const revenueOpsRouter = router({
  voiceScorecard: adminProcedure.input(rangeSchema).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const conditions = [gte(vapiCallLogs.createdAt, new Date(input.sinceISO))];
    if (input.untilISO) conditions.push(lte(vapiCallLogs.createdAt, new Date(input.untilISO)));

    const rows = await db.select({
      id: vapiCallLogs.id,
      createdAt: vapiCallLogs.createdAt,
      evalOutcome: vapiCallLogs.evalOutcome,
      evalScore: vapiCallLogs.evalScore,
      metadata: vapiCallLogs.metadata,
    }).from(vapiCallLogs).where(and(...conditions));

    let qualified = 0;
    let toolEngaged = 0;
    let leads = 0;
    let callbacks = 0;
    let bookings = 0;
    let walkInsDirected = 0;
    let transferAttempts = 0;
    let arrivals = 0;
    let paidInvoices = 0;
    let technicalFailures = 0;
    let abandoned = 0;
    let spam = 0;
    let legacyUnversioned = 0;
    const qualityScores: number[] = [];
    let dataAsOf: Date | null = null;

    for (const row of rows) {
      if (!dataAsOf || row.createdAt > dataAsOf) dataAsOf = row.createdAt;
      const metadata = asRecord(row.metadata);
      const measurement = asRecord(metadata.revenueOpsV1);
      const facts = asRecord(measurement.facts);
      if (measurement.metricDefinitionVersion !== "revenue-ops-v1") {
        legacyUnversioned++;
        continue;
      }
      const outcome = row.evalOutcome ?? "unknown";
      if (["hard_conversion", "walk_in_directed", "callback_needed", "tire_availability_intent", "quote_or_inspection_intent", "lost_opportunity"].includes(outcome)) qualified++;
      if (facts.toolEngaged === true) toolEngaged++;
      if (facts.leadCreated === true) leads++;
      if (facts.callbackCreated === true) callbacks++;
      if (facts.bookingCreated === true) bookings++;
      if (facts.walkInDirected === true) walkInsDirected++;
      if (facts.transferAttempted === true) transferAttempts++;
      if (facts.arrivalVerified === true) arrivals++;
      if (facts.paidInvoiceVerified === true) paidInvoices++;
      if (outcome === "tech_failure") technicalFailures++;
      if (outcome === "abandoned_before_connect") abandoned++;
      if (outcome === "spam_or_wrong_number") spam++;
      if (typeof row.evalScore === "number") qualityScores.push(row.evalScore);
    }

    const versionedCalls = rows.length - legacyUnversioned;
    return {
      metricDefinitionVersion: "revenue-ops-v1" as const,
      window: { sinceISO: input.sinceISO, untilISO: input.untilISO ?? null, timeZone: "America/New_York" },
      source: "vapi_call_logs" as const,
      dataAsOf: dataAsOf?.toISOString() ?? null,
      counts: {
        totalInboundRecords: rows.length,
        versionedCalls,
        legacyUnversioned,
        qualifiedServiceInquiries: qualified,
        toolEngagements: toolEngaged,
        leadsCreated: leads,
        callbacksCreated: callbacks,
        bookingsCreated: bookings,
        walkInsDirected,
        transferAttempts,
        arrivalsVerified: arrivals,
        paidInvoicesVerified: paidInvoices,
        technicalFailures,
        abandonedCalls: abandoned,
        spamOrWrongNumber: spam,
      },
      rates: {
        qualifiedToLead: { numerator: leads, denominator: qualified, percent: percent(leads, qualified) },
        qualifiedToBooking: { numerator: bookings, denominator: qualified, percent: percent(bookings, qualified) },
        technicalFailure: { numerator: technicalFailures, denominator: versionedCalls, percent: percent(technicalFailures, versionedCalls) },
        abandonment: { numerator: abandoned, denominator: versionedCalls, percent: percent(abandoned, versionedCalls) },
      },
      quality: {
        version: "vapi-quality-v1" as const,
        average: qualityScores.length ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length) : null,
        scoredCalls: qualityScores.length,
        unscoredVersionedCalls: Math.max(0, versionedCalls - qualityScores.length),
      },
      limitations: [
        "Legacy unversioned calls are excluded from stage and quality rates.",
        "Walk-in direction does not prove arrival.",
        "Paid call conversion remains unavailable until a verified invoice link exists.",
      ],
    };
  }),

  gscScorecard: adminProcedure.input(z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).query(async ({ input }) => {
    const { getGscReport, getGscSummary } = await import("../pipelines/gsc-data");
    const [officialResult, detailResult] = await Promise.allSettled([
      getGscReport(input),
      getGscSummary(input),
    ]);
    const official = officialResult.status === "fulfilled" ? officialResult.value.summary : null;
    const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
    const detailRows = detail ? [{
      clicks: detail.totalClicks,
      impressions: detail.totalImpressions,
      position: detail.avgPosition,
    }] : [];
    return {
      window: input,
      source: "Google Search Console" as const,
      dataAsOf: new Date().toISOString(),
      report: buildGscMeasurementReport({
        officialAggregate: official,
        detailRows,
        detailFailed: detailResult.status === "rejected",
        requestedRowLimit: 25_000,
      }),
      errors: {
        official: officialResult.status === "rejected" ? String(officialResult.reason) : null,
        detail: detailResult.status === "rejected" ? String(detailResult.reason) : null,
      },
    };
  }),
});