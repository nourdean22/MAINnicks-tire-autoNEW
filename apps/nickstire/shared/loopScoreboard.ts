/**
 * What each outbound loop is associated with, in dollars.
 *
 * WHY THIS EXISTS
 * The shop runs nine outbound SMS loops — retention_d7 through d365, declined
 * work at 3/7/14/30/45 days, cross_sell — and they all work. cron_log shows zero
 * money-loop failures in seven days. What none of them could report is whether
 * they MAKE ANYTHING. Every existing surface counts sends, replies and opt-outs;
 * `smsPerformance.summary30d` returns sent/replied/converted/optedOut and no
 * money at all.
 *
 * That is the difference between an activity generator and a money system, and
 * it is why "we sent 575 cross-sell texts" felt like progress while nobody could
 * say what it earned.
 *
 * It is only measurable now because #938 repaired the phone identity join —
 * before that, sms_conversations.phone (varied formats) could not be matched to
 * customers.phone (bare 10-digit) and every one of these numbers would have been
 * zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS CORRELATION. IT IS NOT ATTRIBUTION. READ THIS BEFORE QUOTING A NUMBER.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "Revenue observed after" means: this customer received this text, and then paid
 * an invoice within the window. It does NOT mean the text caused the visit.
 *
 * Most of these customers would have come back anyway. A shop with 1,945
 * customers and 2,830 paid invoices has a substantial natural return rate, and
 * this measure cannot separate that from lift. Quoting the total as "revenue the
 * SMS system produced" would overstate it, probably by a lot.
 *
 * What it IS good for: COMPARING loops against each other. Every loop is measured
 * the same way over the same window, so the relative ordering is informative even
 * though the absolute figures are inflated. When one loop sends 575 messages and
 * is associated with 2 invoices while another sends 72 and is associated with 12,
 * that difference is real signal about where the effort is going.
 *
 * The honest way to get true lift is a holdout: withhold the message from a
 * random slice and compare. crossSellOutreach already has a 50/50 control arm,
 * so that measurement is available for at least one loop and is the natural next
 * step. Until then this is a ranking, not a P&L line.
 */

/** One outbound loop, measured identically to every other. */
export interface LoopRow {
  /** variantKey from sms_messages — the loop's own name for itself. */
  loop: string;
  sent: number;
  replied: number;
  optedOut: number;
  /** Paid invoices from recipients inside the window. Correlation. */
  paidInvoicesAfter: number;
  revenueObservedCents: number;
}

export interface LoopScoreboard {
  windowDays: number;
  attributionWindowDays: number;
  loops: LoopRow[];
  totals: {
    sent: number;
    replied: number;
    optedOut: number;
    paidInvoicesAfter: number;
    revenueObservedCents: number;
  };
  /** Stated, never implied. A number without its limits invites over-reading. */
  limitations: string[];
}

/**
 * Rank and total the rows. Pure — rows in, scoreboard out — so the arithmetic is
 * testable and the same rows always produce the same answer.
 *
 * Sorted by revenue because that is the question being asked. Loops with zero
 * revenue are KEPT, not filtered: a loop that sent 575 messages and earned
 * nothing is the single most useful row on the board.
 */
export function buildLoopScoreboard(
  rows: readonly LoopRow[],
  opts: { windowDays: number; attributionWindowDays: number },
): LoopScoreboard {
  const loops = [...rows].sort((a, b) => b.revenueObservedCents - a.revenueObservedCents);

  const totals = loops.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      replied: acc.replied + r.replied,
      optedOut: acc.optedOut + r.optedOut,
      paidInvoicesAfter: acc.paidInvoicesAfter + r.paidInvoicesAfter,
      revenueObservedCents: acc.revenueObservedCents + r.revenueObservedCents,
    }),
    { sent: 0, replied: 0, optedOut: 0, paidInvoicesAfter: 0, revenueObservedCents: 0 },
  );

  const limitations = [
    "CORRELATION, NOT ATTRIBUTION: this counts customers who paid AFTER receiving a message, not because of it. Most would have returned anyway.",
    `Revenue is counted only for PAID invoices dated within ${opts.attributionWindowDays} days of the send.`,
    "Use this to COMPARE loops — every loop is measured the same way. Do not read the total as revenue the SMS system produced.",
    "True lift needs a holdout. crossSellOutreach already runs a 50/50 control arm, so that loop can be measured properly first.",
    "A customer reached by two loops in the window is counted for both — the totals are not a sum of distinct dollars.",
  ];

  if (totals.sent > 0 && totals.paidInvoicesAfter === 0) {
    limitations.push("No recipient paid an invoice in this window. That is a real result, not a missing measurement.");
  }

  return { windowDays: opts.windowDays, attributionWindowDays: opts.attributionWindowDays, loops, totals, limitations };
}

/**
 * Messages sent per invoice observed — the number that makes loops comparable.
 *
 * Returns null rather than Infinity or 0 when nothing converted. A loop with 575
 * sends and no invoices has no meaningful ratio, and rendering that as "0" would
 * make the WORST performer look like the BEST on a sorted column.
 */
export function sendsPerInvoice(row: LoopRow): number | null {
  if (row.paidInvoicesAfter <= 0) return null;
  return Math.round((row.sent / row.paidInvoicesAfter) * 10) / 10;
}
