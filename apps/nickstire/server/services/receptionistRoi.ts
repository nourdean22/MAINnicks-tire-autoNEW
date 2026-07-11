import { and, eq, gte, lte, sql } from "drizzle-orm";

export const CAPTURE_LOW = 0.4;
export const CAPTURE_HIGH = 0.7;

export interface RevenueBand {
  lowCents: number;
  highCents: number;
}

export function estimateRecoveredRevenue(conversions: number, avgTicketCents: number): RevenueBand {
  const per = Math.max(0, conversions) * Math.max(0, avgTicketCents);
  return {
    lowCents: Math.round(per * CAPTURE_LOW),
    highCents: Math.round(per * CAPTURE_HIGH),
  };
}

export interface ReceptionistRoi {
  ok: boolean;
  /** Compatibility name: now means versioned verified demand-capture calls. */
  hardConversions: number;
  /** Versioned qualified calls, not all legacy classifier outcomes. */
  convertingCalls: number;
  avgTicketCents: number;
  invoiceSampleSize: number;
  captureLow: number;
  captureHigh: number;
  estLowCents: number;
  estHighCents: number;
  valueType: "modeled_pipeline_value";
  evidenceLevel: "modeled";
  metricDefinitionVersion: "revenue-ops-v1";
  legacyRowsExcluded: number;
}

const ZERO: ReceptionistRoi = {
  ok: false,
  hardConversions: 0,
  convertingCalls: 0,
  avgTicketCents: 0,
  invoiceSampleSize: 0,
  captureLow: CAPTURE_LOW,
  captureHigh: CAPTURE_HIGH,
  estLowCents: 0,
  estHighCents: 0,
  valueType: "modeled_pipeline_value",
  evidenceLevel: "modeled",
  metricDefinitionVersion: "revenue-ops-v1",
  legacyRowsExcluded: 0,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Planning model only. The count is verified lead/callback/booking persistence;
 * the dollar result is still modeled because those records are not paid invoices.
 */
export async function getReceptionistRoi(opts?: { sinceISO?: string; untilISO?: string }): Promise<ReceptionistRoi> {
  const { getDb } = await import("../db");
  const { vapiCallLogs, invoices } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) return ZERO;

  const since = opts?.sinceISO ? new Date(opts.sinceISO) : new Date(Date.now() - 90 * 86_400_000);
  const conditions = [gte(vapiCallLogs.createdAt, since)];
  if (opts?.untilISO) conditions.push(lte(vapiCallLogs.createdAt, new Date(opts.untilISO)));

  const rows = await db.select({
    evalOutcome: vapiCallLogs.evalOutcome,
    metadata: vapiCallLogs.metadata,
  }).from(vapiCallLogs).where(and(...conditions));

  let verifiedCaptureCalls = 0;
  let qualifiedCalls = 0;
  let legacyRowsExcluded = 0;
  for (const row of rows) {
    const metadata = asRecord(row.metadata);
    const measurement = asRecord(metadata.revenueOpsV1);
    const facts = asRecord(measurement.facts);
    if (measurement.metricDefinitionVersion !== "revenue-ops-v1") {
      legacyRowsExcluded++;
      continue;
    }
    if (facts.leadCreated === true || facts.callbackCreated === true || facts.bookingCreated === true) {
      verifiedCaptureCalls++;
    }
    if ([
      "hard_conversion",
      "walk_in_directed",
      "callback_needed",
      "tire_availability_intent",
      "quote_or_inspection_intent",
      "lost_opportunity",
    ].includes(row.evalOutcome ?? "")) qualifiedCalls++;
  }

  const ticketSince = new Date(Date.now() - 180 * 86_400_000);
  const [ticket] = await db.select({
    avg: sql<number | null>`AVG(${invoices.totalAmount})`,
    n: sql<number>`count(*)`,
  }).from(invoices).where(and(
    eq(invoices.paymentStatus, "paid"),
    gte(invoices.invoiceDate, ticketSince),
    sql`${invoices.totalAmount} > 0`,
  ));

  const avgTicketCents = Math.round(Number(ticket?.avg ?? 0));
  const band = estimateRecoveredRevenue(verifiedCaptureCalls, avgTicketCents);
  return {
    ok: true,
    hardConversions: verifiedCaptureCalls,
    convertingCalls: qualifiedCalls,
    avgTicketCents,
    invoiceSampleSize: Number(ticket?.n ?? 0),
    captureLow: CAPTURE_LOW,
    captureHigh: CAPTURE_HIGH,
    estLowCents: band.lowCents,
    estHighCents: band.highCents,
    valueType: "modeled_pipeline_value",
    evidenceLevel: "modeled",
    metricDefinitionVersion: "revenue-ops-v1",
    legacyRowsExcluded,
  };
}