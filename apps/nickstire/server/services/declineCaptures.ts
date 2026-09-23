/**
 * Counter capture of a declined estimate (Q-37, estate plan §6.2 Option A).
 *
 * The only OBSERVED decline an ALG estimate can have. Everything else on the
 * Declined Work list is inferred from "no matching invoice"; see
 * shared/declineProvenance.ts for how the two are told apart everywhere they show.
 *
 * WHAT THIS DOES NOT DO. It never contacts a customer, and it changes nothing in
 * the declined-recovery SMS lane: that job reads alg_estimates and knows nothing
 * of this table. Whether the lane should treat observed and inferred declines
 * differently is the operator's decision (FEATURE_DECLINED_RECOVERY).
 *
 * The table arrives with hand-applied migration 0131. Until then a read is
 * "not_enabled" and a capture says the migration is pending.
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { isDuplicateKeyError, isMissingTableError } from "../lib/dbErrors";
import type { DeclineCaptureRead } from "../../shared/declineProvenance";

const log = createLogger("services:decline-captures");

const NOT_ENABLED =
  "Counter capture is not enabled yet: migration 0131 (declined_work_captures) has not been applied.";

export type CaptureDeclineResult =
  | { ok: true; kind: "captured" | "already_captured"; capturedAt: Date }
  | { ok: false; reason: "not_enabled" | "not_found" | "db_unavailable" | "error"; error: string };

/**
 * Record that the customer declined this estimate, once.
 *
 * A claim on the unique estimate_id key (claim-before-act): insert; a
 * duplicate-key rejection means someone already captured it, so re-read the
 * winner and report its time. No update path exists, so there is nothing for two
 * tappers to race over beyond the insert itself.
 */
export async function captureDeclineAtCounter(input: {
  estimateId: number;
  capturedBy: string;
}): Promise<CaptureDeclineResult> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { ok: false, reason: "db_unavailable", error: "Database unavailable — nothing was recorded." };

  const { algEstimates, declinedWorkCaptures } = await import("../../drizzle/schema");
  try {
    const [est] = await d
      .select({ id: algEstimates.id, serviceDescription: algEstimates.serviceDescription })
      .from(algEstimates)
      .where(eq(algEstimates.id, input.estimateId))
      .limit(1);
    if (!est) return { ok: false, reason: "not_found", error: `Estimate ${input.estimateId} not found.` };

    try {
      const capturedAt = new Date();
      await d.insert(declinedWorkCaptures).values({
        estimateId: est.id,
        declinedItem: est.serviceDescription ? est.serviceDescription.slice(0, 500) : null,
        source: "counter",
        capturedBy: input.capturedBy.slice(0, 255),
        capturedAt,
      });
      log.info("decline captured at counter", { estimateId: est.id });
      return { ok: true, kind: "captured", capturedAt };
    } catch (err) {
      if (isMissingTableError(err)) return { ok: false, reason: "not_enabled", error: NOT_ENABLED };
      if (!isDuplicateKeyError(err)) throw err;
      const [winner] = await d
        .select({ capturedAt: declinedWorkCaptures.capturedAt })
        .from(declinedWorkCaptures)
        .where(eq(declinedWorkCaptures.estimateId, est.id))
        .limit(1);
      if (!winner) throw new Error(`duplicate capture for estimate ${est.id} but no row to read back`);
      return { ok: true, kind: "already_captured", capturedAt: winner.capturedAt };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("decline capture failed", { estimateId: input.estimateId, err: message.slice(0, 200) });
    return { ok: false, reason: "error", error: message.slice(0, 200) };
  }
}

/**
 * Which of these estimates were captured at the counter. Three outcomes, never
 * two: a failed read is "error", not an empty set — an empty set would render
 * every row as "inferred", a confident claim about rows we could not see.
 */
export async function readDeclineCaptures(estimateIds: readonly number[]): Promise<DeclineCaptureRead> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { status: "error", available: false, error: "database unavailable" };
  if (estimateIds.length === 0) return { status: "ok", capturedIds: new Set() };
  try {
    const { declinedWorkCaptures } = await import("../../drizzle/schema");
    const rows = await d
      .select({ estimateId: declinedWorkCaptures.estimateId })
      .from(declinedWorkCaptures)
      .where(inArray(declinedWorkCaptures.estimateId, [...estimateIds]));
    return { status: "ok", capturedIds: new Set(rows.map((r: { estimateId: number }) => r.estimateId)) };
  } catch (err) {
    if (isMissingTableError(err)) return { status: "not_enabled" };
    const message = err instanceof Error ? err.message : String(err);
    log.warn("decline capture read failed", { err: message.slice(0, 200) });
    return { status: "error", error: message.slice(0, 200) };
  }
}

export type ConfirmedCountRead =
  | { status: "ok"; count: number }
  | { status: "not_enabled" }
  | { status: "error"; available?: false; error: string };

/**
 * How many UNMATCHED estimates since `since` were captured at the counter — the
 * observed share of an unmatched total. Totals render as "N estimates · C at
 * counter, rest inferred"; a failed read says the split is unknown instead of
 * implying zero were observed.
 */
export async function countCounterConfirmedUnmatched(since: Date): Promise<ConfirmedCountRead> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { status: "error", available: false, error: "database unavailable" };
  try {
    const { algEstimates, declinedWorkCaptures } = await import("../../drizzle/schema");
    const [row] = await d
      .select({ c: sql<number>`count(*)` })
      .from(declinedWorkCaptures)
      .innerJoin(algEstimates, eq(algEstimates.id, declinedWorkCaptures.estimateId))
      .where(and(isNull(algEstimates.matchedInvoiceId), gte(algEstimates.estimateDate, since)));
    return { status: "ok", count: Number(row?.c ?? 0) };
  } catch (err) {
    if (isMissingTableError(err)) return { status: "not_enabled" };
    const message = err instanceof Error ? err.message : String(err);
    log.warn("counter-confirmed count failed", { err: message.slice(0, 200) });
    return { status: "error", error: message.slice(0, 200) };
  }
}

/** " · 2 confirmed at counter, rest inferred" — or says the split is unknown. */
export function describeConfirmedShare(total: number, read: ConfirmedCountRead): string {
  if (read.status === "error") return " · counter/inferred split unknown";
  const confirmed = read.status === "ok" ? read.count : 0;
  if (confirmed === 0) return " · all inferred (no matching invoice)";
  if (confirmed >= total) return " · all confirmed at counter";
  return ` · ${confirmed} confirmed at counter, ${total - confirmed} inferred`;
}
