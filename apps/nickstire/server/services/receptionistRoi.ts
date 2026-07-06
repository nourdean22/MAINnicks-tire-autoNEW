/**
 * Voice Receptionist ROI — an HONEST estimate of the revenue the AI receptionist
 * drives, built from MEASURED conversions × a real average ticket value.
 *
 * Design (clarity-gate): no fabricated bookings (respects the no-lead-noise rule).
 * Conversions are counted from vapi_call_logs eval outcomes (facts). The value-per-
 * job is AVG(paid invoices) (a fact). The dollar figure is a clearly-bounded RANGE
 * using a conservative 40-70% capture band, because a committed call is not a
 * guaranteed paid job. Facts are exact; the $ is explicitly an estimate.
 */
import { and, gte, lte, eq, inArray, sql } from "drizzle-orm";

/** Fraction of committed calls assumed to become paid jobs (the honest unknown). */
export const CAPTURE_LOW = 0.4;
export const CAPTURE_HIGH = 0.7;

/** Eval outcomes that represent committed customer intent the receptionist produced. */
const CONVERTING_OUTCOMES = [
  "hard_conversion",
  "walk_in_directed",
  "tire_availability_intent",
  "quote_or_inspection_intent",
] as const;

export interface RevenueBand {
  lowCents: number;
  highCents: number;
}

/**
 * Pure — the recovered-revenue band from conversions × avg ticket × capture band.
 * Clamps negatives to 0. Unit-tested in receptionistRoi.test.ts.
 */
export function estimateRecoveredRevenue(conversions: number, avgTicketCents: number): RevenueBand {
  const per = Math.max(0, conversions) * Math.max(0, avgTicketCents);
  return {
    lowCents: Math.round(per * CAPTURE_LOW),
    highCents: Math.round(per * CAPTURE_HIGH),
  };
}

export interface ReceptionistRoi {
  ok: boolean;
  hardConversions: number;
  convertingCalls: number;
  avgTicketCents: number;
  invoiceSampleSize: number;
  captureLow: number;
  captureHigh: number;
  estLowCents: number;
  estHighCents: number;
}

const ZERO: ReceptionistRoi = {
  ok: false, hardConversions: 0, convertingCalls: 0, avgTicketCents: 0,
  invoiceSampleSize: 0, captureLow: CAPTURE_LOW, captureHigh: CAPTURE_HIGH,
  estLowCents: 0, estHighCents: 0,
};

/**
 * Compute the receptionist ROI over a call window (defaults to the last 90 days).
 * Value-per-job is the average PAID ticket over the last 180 days — a current,
 * stable figure independent of the call window.
 */
export async function getReceptionistRoi(opts?: { sinceISO?: string; untilISO?: string }): Promise<ReceptionistRoi> {
  const { getDb } = await import("../db");
  const { vapiCallLogs, invoices } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) return ZERO;

  const since = opts?.sinceISO ? new Date(opts.sinceISO) : new Date(Date.now() - 90 * 86400000);
  const callConds = [gte(vapiCallLogs.createdAt, since)];
  if (opts?.untilISO) callConds.push(lte(vapiCallLogs.createdAt, new Date(opts.untilISO)));

  const [hard] = await db
    .select({ n: sql<number>`count(*)` })
    .from(vapiCallLogs)
    .where(and(...callConds, eq(vapiCallLogs.evalOutcome, "hard_conversion")));

  const [converting] = await db
    .select({ n: sql<number>`count(*)` })
    .from(vapiCallLogs)
    .where(and(...callConds, inArray(vapiCallLogs.evalOutcome, [...CONVERTING_OUTCOMES])));

  const ticketSince = new Date(Date.now() - 180 * 86400000);
  const [ticket] = await db
    .select({ avg: sql<number | null>`AVG(${invoices.totalAmount})`, n: sql<number>`count(*)` })
    .from(invoices)
    .where(and(eq(invoices.paymentStatus, "paid"), gte(invoices.invoiceDate, ticketSince), sql`${invoices.totalAmount} > 0`));

  const hardConversions = Number(hard?.n ?? 0);
  const avgTicketCents = Math.round(Number(ticket?.avg ?? 0));
  const band = estimateRecoveredRevenue(hardConversions, avgTicketCents);

  return {
    ok: true,
    hardConversions,
    convertingCalls: Number(converting?.n ?? 0),
    avgTicketCents,
    invoiceSampleSize: Number(ticket?.n ?? 0),
    captureLow: CAPTURE_LOW,
    captureHigh: CAPTURE_HIGH,
    estLowCents: band.lowCents,
    estHighCents: band.highCents,
  };
}
