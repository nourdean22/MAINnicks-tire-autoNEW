/**
 * ATTRIBUTION DEDUPE — an invoice can be paid once, so it can be claimed once.
 *
 * FOUND IN PRODUCTION, 2026-09-18, by opening the admin page rather than by
 * reading code. The attribution review queue showed 20 weak matches, and EIGHT
 * of them pointed at the same invoice #5160005:
 *
 *   call 16440001 -> invoice 5160005      call 16350006 -> invoice 5160005
 *   call 16440002 -> invoice 5160005      call 16350007 -> invoice 5160005
 *   call 16440003 -> invoice 5160005      call 16260032 -> invoice 5160005
 *   call 16440005 -> invoice 5160005      call 16260035 -> invoice 5160005
 *
 * The review query already dedupes by `call_id` — it takes the latest candidate
 * per call — but nothing dedupes by `invoice_id`. So one customer who rang eight
 * times before coming in generated EIGHT independent decisions, each of which
 * says "this call produced this invoice". Confirm them all and the invoice is
 * counted eight times.
 *
 * WHY THIS IS THE WORSE FAILURE OF THE TWO THIS WAVE FIXED. The missed-revenue
 * queue inflated DEMAND, which wastes attention. This inflates REVENUE — the
 * number the system is judged by, and the number an operator would quote to
 * justify the whole programme. A recovery tool that over-reports its own
 * winnings is the failure mode most likely to survive scrutiny, because nobody
 * audits a number they like.
 *
 * WHAT THIS IS NOT. It is not a claim that the other seven calls are unrelated.
 * They very likely are related — it is one customer, one need, one visit. That
 * is precisely why they are ONE episode with one economic outcome, not eight.
 * The duplicates are preserved and pointed at the primary so the operator can
 * still see the whole contact history; they simply stop being separate
 * decisions about separate money.
 *
 * Pure and total: no DB, no clock beyond the timestamps on the rows.
 */

export interface AttributionCandidate {
  id: number;
  callId: number;
  invoiceId: number | null;
  confidence: number | null;
  resolution: string;
  createdAt: Date;
  /** Present on real rows; unused here but carried through untouched. */
  [key: string]: unknown;
}

export interface CollapsedCandidate extends AttributionCandidate {
  /**
   * When set, another call already claims this invoice. This row is retained
   * for context and MUST NOT be presented as an independent revenue decision.
   */
  sameInvoiceAs: number | null;
  /** How many candidates in total claim this invoice, including the primary. */
  claimantCount: number;
}

export interface CollapseResult {
  /** One row per invoice — the decisions a human should actually make. */
  primary: CollapsedCandidate[];
  /** Rows suppressed because their invoice is already claimed. */
  duplicates: CollapsedCandidate[];
  /**
   * Invoices claimed by more than one call. A non-empty list is not an error:
   * it is the normal shape of a customer who called several times. It IS an
   * error to bill for it more than once.
   */
  contestedInvoiceIds: number[];
}

/**
 * Pick the call that owns an invoice.
 *
 * Highest confidence wins. On a tie the EARLIEST call wins, because the call
 * that started the customer's journey is the better causal claim than the one
 * that happened to be closest to the payment — a caller confirming directions
 * ten minutes before arriving did not cause the visit.
 */
function primaryOf(rows: AttributionCandidate[]): AttributionCandidate {
  return [...rows].sort((a, b) => {
    const ca = a.confidence ?? 0;
    const cb = b.confidence ?? 0;
    if (cb !== ca) return cb - ca;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

/**
 * Collapse candidates so each invoice is claimed exactly once.
 *
 * Candidates with a null `invoiceId` are pass-through primaries: they assert no
 * invoice, so they cannot double-count one. (`multiple_plausible_invoices` rows
 * arrive this way and stay visible — an ambiguous match is still a decision
 * worth a human, it just is not a claim on specific money.)
 */
export function collapseByInvoice(rows: readonly AttributionCandidate[]): CollapseResult {
  const byInvoice = new Map<number, AttributionCandidate[]>();
  const noInvoice: AttributionCandidate[] = [];

  for (const r of rows) {
    if (r.invoiceId == null) {
      noInvoice.push(r);
      continue;
    }
    const bucket = byInvoice.get(r.invoiceId);
    if (bucket) bucket.push(r);
    else byInvoice.set(r.invoiceId, [r]);
  }

  const primary: CollapsedCandidate[] = noInvoice.map((r) => ({
    ...r,
    sameInvoiceAs: null,
    claimantCount: 1,
  }));
  const duplicates: CollapsedCandidate[] = [];
  const contested: number[] = [];

  for (const [invoiceId, bucket] of byInvoice) {
    const winner = primaryOf(bucket);
    const claimantCount = bucket.length;
    if (claimantCount > 1) contested.push(invoiceId);
    for (const r of bucket) {
      const row: CollapsedCandidate = {
        ...r,
        sameInvoiceAs: r.callId === winner.callId ? null : winner.callId,
        claimantCount,
      };
      if (r.callId === winner.callId) primary.push(row);
      else duplicates.push(row);
    }
  }

  return { primary, duplicates, contestedInvoiceIds: contested.sort((a, b) => a - b) };
}

/**
 * The number that may be reported, and the number that may not.
 *
 * `distinctInvoices` is the only honest count of attributed conversions.
 * `candidateRows` is what the old queue showed, and reporting it as
 * conversions is the over-count this module exists to prevent — so both are
 * returned together and the gap is named.
 */
export function attributionCounts(result: CollapseResult): {
  distinctInvoices: number;
  candidateRows: number;
  suppressedDuplicates: number;
  overcountFactor: number | null;
} {
  const distinctInvoices = result.primary.filter((r) => r.invoiceId != null).length;
  const candidateRows = result.primary.length + result.duplicates.length;
  return {
    distinctInvoices,
    candidateRows,
    suppressedDuplicates: result.duplicates.length,
    // How many times the naive count would have billed the same money.
    overcountFactor:
      distinctInvoices > 0
        ? Math.round(((distinctInvoices + result.duplicates.length) / distinctInvoices) * 100) / 100
        : null,
  };
}
