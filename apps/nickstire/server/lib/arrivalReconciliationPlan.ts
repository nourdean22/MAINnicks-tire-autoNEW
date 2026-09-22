/**
 * ONE INVOICE RECONCILES ONE ARRIVAL. Pure planner for expectedArrivals.
 *
 * WHY THIS EXISTS. reconcileExpectedArrivals used to be a single
 * UPDATE ... JOIN invoices with no uniqueness anywhere: every 'expected' row whose
 * phone matched an invoice inside its 3-day window was stamped with that invoice.
 * A customer who said "coming today" on Monday, Tuesday and Wednesday and then
 * paid once on Wednesday has three arrival rows and one invoice — and all three
 * were marked `arrived` with the SAME reconciledInvoiceId.
 *
 * That was not a bookkeeping curiosity. weeklyRevenueDigest sums i.totalAmount
 * PER ARRIVAL ROW, so the one invoice was added once per claimant, in the line
 * labelled "arrivals -> paid invoices" that the operator reads as revenue. The
 * identical shape — eight calls claiming one invoice — had already been found
 * and fixed on the call->invoice path on 2026-09-18; this was the same defect
 * one table over. Measured on 2026-09-22 before fixing: 25 claims, 25 distinct
 * invoices, $0.00 overstated. Real in the code, not yet fired.
 *
 * The SQL still decides WHICH pairs are candidates (same phone, invoice dated in
 * the arrival's window, invoice not already claimed) — those day-boundary
 * semantics are unchanged and stay in the database's timezone. This function
 * only decides, deterministically, which candidate pairs are applied.
 *
 * RULES.
 *   1. An invoice is claimed by at most one arrival; an arrival claims at most
 *      one invoice.
 *   2. For each invoice, the winning arrival is the one whose expectedDate is
 *      LATEST (closest to the visit that actually happened). Ties: the earliest
 *      created, then the lowest id. Every tie-break is total, so the plan is
 *      identical on every run.
 *   3. Invoices are processed oldest-first, so a customer who genuinely came
 *      twice inside one window gets two arrivals reconciled to two invoices.
 *   4. An arrival left unmatched whose window contained an invoice that WAS
 *      matched to a sibling is the same visit, recorded on an earlier day. It
 *      is reported as SUPERSEDED so the caller can close it, rather than leaving
 *      it to age into `no_show` — which would tell the recovery queue this
 *      customer never came, about a customer who came and paid.
 *   5. An arrival with no matched invoice at all is left alone. It may still be
 *      a genuine no-show, and that is the sweep's call, not this planner's.
 */

export interface ArrivalCandidate {
  arrivalId: number;
  /** YYYY-MM-DD, formatted in SQL so no driver timezone skew reaches here. */
  expectedDate: string;
  /** UNIX seconds, formatted in SQL for the same reason. */
  createdTs: number;
  invoiceId: number;
  /** YYYY-MM-DD, formatted in SQL. */
  invoiceDate: string;
}

export interface ReconciliationPlan {
  matches: Array<{ arrivalId: number; invoiceId: number }>;
  superseded: Array<{ arrivalId: number; byArrivalId: number; invoiceId: number }>;
}

export function planArrivalReconciliation(pairs: readonly ArrivalCandidate[]): ReconciliationPlan {
  // Group candidate arrivals under each invoice.
  const byInvoice = new Map<number, { invoiceDate: string; arrivals: ArrivalCandidate[] }>();
  for (const p of pairs) {
    const g = byInvoice.get(p.invoiceId) ?? { invoiceDate: p.invoiceDate, arrivals: [] };
    g.arrivals.push(p);
    byInvoice.set(p.invoiceId, g);
  }

  // Oldest invoice first; id breaks ties so two same-day invoices are ordered.
  const invoices = [...byInvoice.entries()].sort(
    (a, b) => a[1].invoiceDate.localeCompare(b[1].invoiceDate) || a[0] - b[0],
  );

  const claimedArrivals = new Set<number>();
  const invoiceWinner = new Map<number, number>(); // invoiceId -> arrivalId
  const matches: ReconciliationPlan["matches"] = [];

  for (const [invoiceId, g] of invoices) {
    const winner = g.arrivals
      .filter((a) => !claimedArrivals.has(a.arrivalId))
      .sort(
        (a, b) =>
          b.expectedDate.localeCompare(a.expectedDate) || // latest expected day wins
          a.createdTs - b.createdTs ||                    // then the earliest record
          a.arrivalId - b.arrivalId,                      // then a total order
      )[0];
    if (!winner) continue;
    claimedArrivals.add(winner.arrivalId);
    invoiceWinner.set(invoiceId, winner.arrivalId);
    matches.push({ arrivalId: winner.arrivalId, invoiceId });
  }

  // Same visit, earlier day: unmatched arrivals whose candidate invoice went to
  // a sibling. One entry per arrival, against the earliest such invoice.
  const supersededBy = new Map<number, { byArrivalId: number; invoiceId: number; invoiceDate: string }>();
  for (const p of pairs) {
    if (claimedArrivals.has(p.arrivalId)) continue;
    const by = invoiceWinner.get(p.invoiceId);
    if (by == null) continue;
    const prev = supersededBy.get(p.arrivalId);
    if (!prev || p.invoiceDate < prev.invoiceDate || (p.invoiceDate === prev.invoiceDate && p.invoiceId < prev.invoiceId)) {
      supersededBy.set(p.arrivalId, { byArrivalId: by, invoiceId: p.invoiceId, invoiceDate: p.invoiceDate });
    }
  }
  const superseded = [...supersededBy.entries()]
    .map(([arrivalId, s]) => ({ arrivalId, byArrivalId: s.byArrivalId, invoiceId: s.invoiceId }))
    .sort((a, b) => a.arrivalId - b.arrivalId);

  matches.sort((a, b) => a.arrivalId - b.arrivalId);
  return { matches, superseded };
}
