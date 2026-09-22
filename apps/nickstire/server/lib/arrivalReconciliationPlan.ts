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
 *   2. AS MANY VISITS AS THE EVIDENCE SUPPORTS. The assignment is a MAXIMUM
 *      matching, not a greedy pass. Review on PR #2488 found the greedy
 *      version losing a visit: arrivals expected Sep 21 and Sep 22, invoices on
 *      Sep 22 and Sep 24. The Sep 22 invoice is eligible for both arrivals, the
 *      Sep 24 invoice only for the Sep 22 one; taking the closest arrival for
 *      the older invoice consumed Sep 22, left Sep 24 unmatched, and then
 *      recorded the Sep 21 row as superseded — one visit written, two paid for.
 *      Augmenting paths fix that: an invoice that finds its candidates taken
 *      may displace a sibling onto that sibling's next option.
 *   3. Among maximum matchings, preference is closeness: for each invoice the
 *      arrival whose expectedDate is LATEST (nearest the visit) is tried first,
 *      then earliest created, then lowest id. Invoices are processed
 *      oldest-first. Every tie-break is total, so the plan is identical on
 *      every run.
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

  // Each invoice's candidates in PREFERENCE order (rule 3), de-duplicated —
  // the same arrival can appear once per pair row, but it is one candidate.
  const preferred = new Map<number, number[]>();
  for (const [invoiceId, g] of invoices) {
    const seen = new Set<number>();
    const ordered = [...g.arrivals]
      .sort(
        (a, b) =>
          b.expectedDate.localeCompare(a.expectedDate) || // latest expected day first
          a.createdTs - b.createdTs ||                    // then the earliest record
          a.arrivalId - b.arrivalId,                      // then a total order
      )
      .map((a) => a.arrivalId)
      .filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
    preferred.set(invoiceId, ordered);
  }

  // Maximum bipartite matching by augmenting paths (Kuhn). Each invoice takes
  // its most-preferred free arrival; if every candidate is taken, it tries to
  // move a sibling invoice onto THAT sibling's next option, recursively. Sizes
  // here are a handful of rows per phone, so the classic O(V·E) is instant.
  const arrivalOwner = new Map<number, number>(); // arrivalId -> invoiceId
  //
  // Two passes per invoice, sharing one visited set so the search stays a
  // complete augmenting-path search: FREE candidates first in preference
  // order, and only when none is free, displacement. Plain Kuhn augments
  // through the first candidate it meets, which would push a sibling off its
  // closest arrival even when this invoice had a free second choice — a
  // maximum matching, but not the closeness rule 3 promises when it is free.
  const tryAssign = (invoiceId: number, visited: Set<number>): boolean => {
    const candidates = preferred.get(invoiceId) ?? [];
    for (const arrivalId of candidates) {
      if (visited.has(arrivalId) || arrivalOwner.has(arrivalId)) continue;
      visited.add(arrivalId);
      arrivalOwner.set(arrivalId, invoiceId);
      return true;
    }
    for (const arrivalId of candidates) {
      if (visited.has(arrivalId)) continue;
      visited.add(arrivalId);
      const owner = arrivalOwner.get(arrivalId);
      if (owner != null && tryAssign(owner, visited)) {
        arrivalOwner.set(arrivalId, invoiceId);
        return true;
      }
    }
    return false;
  };
  for (const [invoiceId] of invoices) tryAssign(invoiceId, new Set());

  const invoiceWinner = new Map<number, number>(); // invoiceId -> arrivalId
  for (const [arrivalId, invoiceId] of arrivalOwner) invoiceWinner.set(invoiceId, arrivalId);
  const claimedArrivals = new Set(arrivalOwner.keys());

  const matches: ReconciliationPlan["matches"] = [...invoiceWinner.entries()]
    .map(([invoiceId, arrivalId]) => ({ arrivalId, invoiceId }))
    .sort((a, b) => a.arrivalId - b.arrivalId);

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

  return { matches, superseded };
}
