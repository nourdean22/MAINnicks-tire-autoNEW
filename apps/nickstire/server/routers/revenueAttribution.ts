import { and, eq, gte, lte } from "drizzle-orm";
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

const dateRangeSchema = z.object({
  sinceISO: z.string().datetime(),
  untilISO: z.string().datetime().optional(),
});

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
        "This endpoint is read-only and does not mutate historical attribution.",
      ],
    };
  }),
});
