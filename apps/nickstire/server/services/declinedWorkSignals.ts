/**
 * Declined-work signals — the live-IO half of shared/declinedWorkTopics.
 *
 * Same split as contentTopicMiner (pure) / contentTopicSignals (IO): ranking
 * stays testable, fetching stays here.
 *
 * ★ READ-ONLY, AND NOT AN ALG PROBE. This reads the LOCAL `alg_estimates`
 * mirror, which shopDriverEstimateSync populates. It never contacts ALG /
 * ShopDriver — that system is read-only by standing rule and nothing here
 * should ever become a reason to reopen that question.
 *
 * ★ A CAVEAT THAT CHANGES HOW YOU READ THE OUTPUT (measured 2026-08-08).
 * `matched_invoice_id` has been populated exactly 5 times in the table's life,
 * ALL on 2026-05-07 — a one-off backfill, not a running matcher. The matching
 * code lives inside shopDriverEstimateSync and is not on any schedule. So
 * "unmatched" currently means "the matcher has not run", NOT "the customer
 * declined". 92 estimates created since that date, zero matched, while invoices
 * flowed normally at 105-145/month.
 *
 * For CONTENT that is tolerable and worth saying plainly: the worst case is a
 * post about a repair someone actually bought, which is merely a less pointed
 * topic — not a false claim, because the counts never reach the copy (see
 * declinedWorkTopics header). For OUTREACH it would not be tolerable, and the
 * declined-recovery cron currently texts against this same field.
 * `SIGNAL_CONFIDENCE` below is the honest label, and callers should surface it
 * rather than presenting these as confirmed refusals.
 */
import { createLogger } from "../lib/logger";
import {
  mineDeclinedWorkTopics,
  type DeclinedTopicCandidate,
  type DeclinedWorkRow,
} from "../../shared/declinedWorkTopics";

const log = createLogger("services:declined-work-signals");

/**
 * How much to trust "unmatched = declined" today. Flipped to "confirmed" only
 * when the matcher runs on a schedule — do not hardcode optimism here.
 */
export const SIGNAL_CONFIDENCE = "unverified_match" as const;

/** Only look this far back — a two-year-old estimate is not a live objection. */
const LOOKBACK_DAYS = 540;

export interface DeclinedSignalResult {
  candidates: DeclinedTopicCandidate[];
  /** Distinct repairs considered before ranking. */
  rowsConsidered: number;
  confidence: typeof SIGNAL_CONFIDENCE;
  /** Present when the read failed — callers degrade, they do not throw. */
  error?: string;
}

/**
 * Aggregate open estimates by repair and rank them.
 *
 * Aggregation happens in SQL rather than in the pure module because the pure
 * module should never learn row shapes. GROUP BY on the raw description is
 * deliberate: normalisation to a part name happens in the pure layer, where it
 * is unit-tested, and doing it in SQL would put that logic somewhere no test
 * can reach it.
 */
export async function fetchDeclinedWorkTopics(limit = 12): Promise<DeclinedSignalResult> {
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) return { candidates: [], rowsConsidered: 0, confidence: SIGNAL_CONFIDENCE, error: "database unavailable" };

    const { sql } = await import("drizzle-orm");
    const [raw] = await d.execute(sql`
      SELECT service_description AS serviceDescription,
             COUNT(*) AS cnt,
             ROUND(AVG(estimated_amount)) AS avgAmountCents
      FROM alg_estimates
      WHERE matched_invoice_id IS NULL
        AND service_description IS NOT NULL
        AND service_description <> ''
        AND estimate_date >= DATE_SUB(CURDATE(), INTERVAL ${LOOKBACK_DAYS} DAY)
      GROUP BY service_description
      ORDER BY cnt DESC
      LIMIT 60
    `);

    const rows: DeclinedWorkRow[] = (raw as unknown as Array<Record<string, unknown>>).map((r) => ({
      serviceDescription: String(r.serviceDescription ?? ""),
      count: Number(r.cnt ?? 0),
      avgAmountCents: Number(r.avgAmountCents ?? 0),
    }));

    const candidates = mineDeclinedWorkTopics(rows, { limit });
    log.info("declined-work topics mined", {
      rowsConsidered: rows.length,
      candidates: candidates.length,
      confidence: SIGNAL_CONFIDENCE,
      top: candidates[0]?.part,
    });
    return { candidates, rowsConsidered: rows.length, confidence: SIGNAL_CONFIDENCE };
  } catch (err) {
    // A dead signal must degrade the topic feed, never take the content run
    // down — the other sources still produce candidates without this one.
    const message = err instanceof Error ? err.message : String(err);
    log.warn("declined-work signal unavailable", { err: message.slice(0, 200) });
    return { candidates: [], rowsConsidered: 0, confidence: SIGNAL_CONFIDENCE, error: message.slice(0, 200) };
  }
}
