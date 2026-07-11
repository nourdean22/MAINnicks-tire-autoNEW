export const ATTRIBUTION_DEFINITION_VERSION = "revenue-attribution-v1";

export type AttributionEvidenceLevel = "observed" | "inferred" | "verified";
export type AttributionResolution = "attributed" | "manual_review" | "unmatched" | "ambiguous";

export interface LeadInvoiceRow {
  leadId: number;
  source: string;
  utmSource: string | null;
  invoiceId: number | null;
  invoiceStatus: string | null;
  invoiceAmountCents: number | null;
}

export interface SourceAttributionRow {
  source: string;
  utmSource: string | null;
  leadCount: number;
  uniquelyLinkedPaidInvoices: number;
  verifiedRevenueCents: number;
}

export interface AttributionSummary {
  metricDefinitionVersion: typeof ATTRIBUTION_DEFINITION_VERSION;
  sources: SourceAttributionRow[];
  totals: {
    leadCount: number;
    uniquelyLinkedPaidInvoices: number;
    verifiedRevenueCents: number;
    ambiguousInvoiceCount: number;
    unpaidOrMissingInvoiceLinks: number;
  };
  limitations: string[];
}

function sourceKey(source: string, utmSource: string | null): string {
  return `${source}\u0000${utmSource ?? ""}`;
}

export function aggregateVerifiedLeadRevenue(rows: readonly LeadInvoiceRow[]): AttributionSummary {
  const invoiceClaims = new Map<number, LeadInvoiceRow[]>();
  const bySource = new Map<string, SourceAttributionRow>();
  let unpaidOrMissingInvoiceLinks = 0;

  for (const row of rows) {
    const key = sourceKey(row.source, row.utmSource);
    const current = bySource.get(key) ?? {
      source: row.source,
      utmSource: row.utmSource,
      leadCount: 0,
      uniquelyLinkedPaidInvoices: 0,
      verifiedRevenueCents: 0,
    };
    current.leadCount += 1;
    bySource.set(key, current);

    if (row.invoiceId == null || row.invoiceStatus !== "paid" || !row.invoiceAmountCents || row.invoiceAmountCents <= 0) {
      unpaidOrMissingInvoiceLinks += 1;
      continue;
    }
    const claims = invoiceClaims.get(row.invoiceId) ?? [];
    claims.push(row);
    invoiceClaims.set(row.invoiceId, claims);
  }

  let ambiguousInvoiceCount = 0;
  for (const claims of invoiceClaims.values()) {
    if (claims.length !== 1) {
      ambiguousInvoiceCount += 1;
      continue;
    }
    const claim = claims[0];
    const current = bySource.get(sourceKey(claim.source, claim.utmSource));
    if (!current) continue;
    current.uniquelyLinkedPaidInvoices += 1;
    current.verifiedRevenueCents += Math.max(0, Number(claim.invoiceAmountCents) || 0);
  }

  const sources = [...bySource.values()].sort((a, b) =>
    b.verifiedRevenueCents - a.verifiedRevenueCents || b.leadCount - a.leadCount,
  );

  return {
    metricDefinitionVersion: ATTRIBUTION_DEFINITION_VERSION,
    sources,
    totals: {
      leadCount: rows.length,
      uniquelyLinkedPaidInvoices: sources.reduce((sum, row) => sum + row.uniquelyLinkedPaidInvoices, 0),
      verifiedRevenueCents: sources.reduce((sum, row) => sum + row.verifiedRevenueCents, 0),
      ambiguousInvoiceCount,
      unpaidOrMissingInvoiceLinks,
    },
    limitations: [
      "Revenue is attributed only when one lead uniquely links to one paid invoice.",
      "Invoices claimed by multiple leads are excluded and require manual resolution.",
      "Unlinked, pending, partial, or refunded invoices are not verified attributed revenue.",
    ],
  };
}

export interface CallObservation {
  callId: number;
  phoneNumber: string | null;
  leadId: number | null;
  serviceMention: string | null;
  occurredAt: Date;
}

export interface PaidInvoiceObservation {
  invoiceId: number;
  customerPhone: string | null;
  customerId: number | null;
  serviceDescription: string | null;
  paidAt: Date;
  amountCents: number;
}

export interface LeadLinkObservation {
  leadId: number;
  invoiceId: number | null;
}

export interface CallInvoiceCandidate {
  callId: number;
  invoiceId: number | null;
  resolution: AttributionResolution;
  evidenceLevel: AttributionEvidenceLevel;
  confidence: number | null;
  reasons: string[];
}

export function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function serviceTokens(value: string | null): Set<string> {
  return new Set((value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4));
}

function serviceOverlap(a: string | null, b: string | null): boolean {
  const left = serviceTokens(a);
  const right = serviceTokens(b);
  for (const token of left) if (right.has(token)) return true;
  return false;
}

export function buildCallInvoiceCandidates(args: {
  calls: readonly CallObservation[];
  paidInvoices: readonly PaidInvoiceObservation[];
  leadLinks: readonly LeadLinkObservation[];
  maxDays?: number;
}): CallInvoiceCandidate[] {
  const maxDays = args.maxDays ?? 14;
  const maxMs = maxDays * 86_400_000;
  const invoiceById = new Map(args.paidInvoices.map((invoice) => [invoice.invoiceId, invoice]));
  const invoiceIdByLead = new Map(args.leadLinks.map((lead) => [lead.leadId, lead.invoiceId]));
  const claimCountByInvoice = new Map<number, number>();
  for (const lead of args.leadLinks) {
    if (lead.invoiceId == null) continue;
    claimCountByInvoice.set(lead.invoiceId, (claimCountByInvoice.get(lead.invoiceId) ?? 0) + 1);
  }

  return args.calls.map((call) => {
    const directInvoiceId = call.leadId == null ? null : invoiceIdByLead.get(call.leadId) ?? null;
    if (directInvoiceId != null && invoiceById.has(directInvoiceId)) {
      if ((claimCountByInvoice.get(directInvoiceId) ?? 0) !== 1) {
        return {
          callId: call.callId,
          invoiceId: directInvoiceId,
          resolution: "ambiguous",
          evidenceLevel: "inferred",
          confidence: null,
          reasons: ["call linked to lead", "paid invoice is claimed by multiple leads"],
        };
      }
      return {
        callId: call.callId,
        invoiceId: directInvoiceId,
        resolution: "attributed",
        evidenceLevel: "verified",
        confidence: 1,
        reasons: ["call linked to lead", "lead uniquely linked to paid invoice"],
      };
    }

    const phone = normalizePhone(call.phoneNumber);
    if (!phone) {
      return {
        callId: call.callId,
        invoiceId: null,
        resolution: "unmatched",
        evidenceLevel: "observed",
        confidence: null,
        reasons: ["call has no matchable phone number"],
      };
    }

    const candidates = args.paidInvoices.filter((invoice) => {
      if (normalizePhone(invoice.customerPhone) !== phone) return false;
      const delta = invoice.paidAt.getTime() - call.occurredAt.getTime();
      return delta >= 0 && delta <= maxMs;
    });

    if (candidates.length === 0) {
      return {
        callId: call.callId,
        invoiceId: null,
        resolution: "unmatched",
        evidenceLevel: "observed",
        confidence: null,
        reasons: [`no paid invoice with the same phone within ${maxDays} days`],
      };
    }

    const serviceMatches = candidates.filter((invoice) => serviceOverlap(call.serviceMention, invoice.serviceDescription));
    const narrowed = serviceMatches.length > 0 ? serviceMatches : candidates;
    if (narrowed.length !== 1) {
      return {
        callId: call.callId,
        invoiceId: null,
        resolution: "ambiguous",
        evidenceLevel: "inferred",
        confidence: null,
        reasons: [`${narrowed.length} plausible paid invoices require manual resolution`],
      };
    }

    const invoice = narrowed[0];
    return {
      callId: call.callId,
      invoiceId: invoice.invoiceId,
      resolution: "manual_review",
      evidenceLevel: "inferred",
      confidence: serviceMatches.length === 1 ? 0.9 : 0.75,
      reasons: serviceMatches.length === 1
        ? ["exact normalized phone", `paid within ${maxDays} days`, "service text overlaps"]
        : ["exact normalized phone", `paid within ${maxDays} days`, "service evidence unavailable or non-matching"],
    };
  });
}
