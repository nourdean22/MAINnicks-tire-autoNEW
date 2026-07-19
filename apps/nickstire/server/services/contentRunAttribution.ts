/**
 * What a piece of content actually EARNED — content run to lead to paid invoice.
 *
 * WHY THIS CLOSES A REAL LOOP
 * The shop already attributes leads to paid invoices with an explicit evidence
 * ladder (revenueAttribution.ts: observed / inferred / verified, and
 * attributed / manual_review / unmatched / ambiguous). What was missing was the
 * step ABOVE it: which piece of content produced the lead.
 *
 * `leads.utmContent` has existed and been CAPTURED on every booking and callback
 * the whole time — and nothing ever read it. Same defect class as the audio
 * verdict that was logged and never persisted, and the artDirection that was
 * generated and ignored: a value produced on every request and consumed by
 * nobody. The field is the join; it only needed a reader.
 *
 * WITHOUT THIS the content engine optimises ATTENTION. A reel with 18,000 views
 * and no bookings and a carousel with 400 views and six paid repairs look the
 * same to every dashboard in the system.
 *
 * PURE, mirroring aggregateVerifiedLeadRevenue. Rows in, summary out, no I/O —
 * so the arithmetic is testable and the same rows always produce the same report.
 */

/** utm_content carries the content run id. Everything hangs off that. */
export const CONTENT_RUN_UTM_PARAM = "utm_content";

export interface ContentLeadRow {
  leadId: number;
  /** leads.utmContent — the content run id, when the lead came from a tracked link. */
  utmContent: string | null;
  invoiceId: number | null;
  invoiceStatus: string | null;
  invoiceAmountCents: number | null;
}

export interface ContentRunRevenue {
  runId: string;
  leadCount: number;
  /** Paid invoices claimed by exactly ONE run. Shared ones are excluded, not split. */
  uniquelyLinkedPaidInvoices: number;
  verifiedRevenueCents: number;
  /** What the run cost to generate, so the ratio is honest. */
  generationCostCents: number;
}

export interface ContentAttributionSummary {
  runs: ContentRunRevenue[];
  totals: {
    leadCount: number;
    attributedLeadCount: number;
    /** Leads with no utm_content at all — the size of the blind spot. */
    unattributedLeadCount: number;
    verifiedRevenueCents: number;
    generationCostCents: number;
    ambiguousInvoiceCount: number;
  };
  /** Stated, never implied. A number without its limits invites over-reading. */
  limitations: string[];
}

/**
 * invoices.paymentStatus is an enum: paid | pending | partial | refunded.
 * Only "paid" counts, and the exclusions are decisions, not oversights:
 *   pending  — not money yet
 *   partial  — counting the FULL amount would overstate revenue, and counting
 *              the paid portion needs a field this table does not carry
 *   refunded — money that came back is not revenue
 * The set is exactly the enum's values, with no speculative extras: a status
 * that cannot occur is a rule nobody can test.
 */
const PAID_STATUSES = new Set(["paid"]);

function isPaid(status: string | null): boolean {
  return Boolean(status && PAID_STATUSES.has(status));
}

/**
 * Aggregate revenue by content run.
 *
 * AN INVOICE CLAIMED BY TWO RUNS IS COUNTED FOR NEITHER. Splitting it would
 * invent a number — there is no evidence for a 50/50 allocation — and assigning
 * it to both would report revenue twice. It is counted as ambiguous and said out
 * loud, which is the same discipline revenueAttribution already applies.
 */
export function aggregateContentRunRevenue(
  rows: readonly ContentLeadRow[],
  costByRun: Readonly<Record<string, number>> = {},
): ContentAttributionSummary {
  const byRun = new Map<string, ContentRunRevenue>();
  const invoiceClaims = new Map<number, Set<string>>();
  let unattributedLeadCount = 0;

  for (const row of rows) {
    const runId = (row.utmContent ?? "").trim();
    if (!runId) {
      unattributedLeadCount++;
      continue;
    }
    if (!byRun.has(runId)) {
      byRun.set(runId, {
        runId, leadCount: 0, uniquelyLinkedPaidInvoices: 0,
        verifiedRevenueCents: 0, generationCostCents: costByRun[runId] ?? 0,
      });
    }
    byRun.get(runId)!.leadCount++;

    if (row.invoiceId != null && isPaid(row.invoiceStatus)) {
      if (!invoiceClaims.has(row.invoiceId)) invoiceClaims.set(row.invoiceId, new Set());
      invoiceClaims.get(row.invoiceId)!.add(runId);
    }
  }

  let ambiguousInvoiceCount = 0;
  const amountByInvoice = new Map<number, number>();
  for (const row of rows) {
    if (row.invoiceId != null && row.invoiceAmountCents != null) {
      amountByInvoice.set(row.invoiceId, row.invoiceAmountCents);
    }
  }

  for (const [invoiceId, runIds] of invoiceClaims) {
    if (runIds.size !== 1) {
      // Two runs, one invoice. No evidence supports any split, so neither gets it.
      ambiguousInvoiceCount++;
      continue;
    }
    const runId = [...runIds][0];
    const target = byRun.get(runId);
    if (!target) continue;
    target.uniquelyLinkedPaidInvoices++;
    target.verifiedRevenueCents += amountByInvoice.get(invoiceId) ?? 0;
  }

  const runs = [...byRun.values()].sort((a, b) => b.verifiedRevenueCents - a.verifiedRevenueCents);
  const attributedLeadCount = runs.reduce((n, r) => n + r.leadCount, 0);

  return {
    runs,
    totals: {
      leadCount: rows.length,
      attributedLeadCount,
      unattributedLeadCount,
      verifiedRevenueCents: runs.reduce((n, r) => n + r.verifiedRevenueCents, 0),
      generationCostCents: runs.reduce((n, r) => n + r.generationCostCents, 0),
      ambiguousInvoiceCount,
    },
    limitations: [
      "Only leads carrying utm_content can be attributed — an untracked link, a walk-in or a direct call is invisible here.",
      "An invoice claimed by two runs is counted for NEITHER; there is no evidence for any split.",
      "Revenue is counted only for invoices in a PAID state. Work in progress is excluded on purpose.",
      unattributedLeadCount > 0
        ? `${unattributedLeadCount} lead(s) had no utm_content and are outside this report entirely.`
        : "Every lead in this window carried utm_content.",
    ],
  };
}

/**
 * Build the tracked link a piece of content should point at.
 *
 * The run id IS the tracking id — no second identifier to keep in sync, and any
 * lead that arrives can be traced back to the exact request that produced the
 * content. Returns a plain string so callers can put it in a caption, a bio link
 * or a story sticker without this module knowing about any of them.
 */
export function buildTrackedUrl(args: {
  baseUrl: string;
  runId: string;
  medium?: string;
  campaign?: string | null;
}): string {
  const url = new URL(args.baseUrl);
  url.searchParams.set("utm_source", "instagram");
  url.searchParams.set("utm_medium", args.medium ?? "organic");
  if (args.campaign) url.searchParams.set("utm_campaign", args.campaign);
  url.searchParams.set(CONTENT_RUN_UTM_PARAM, args.runId);
  return url.toString();
}
