/**
 * 2026-05-27 · Power Atlas Phase 3 · Reciprocity gradient detector.
 *
 * Computes the operator-vs-them initiation ratio for a person over the
 * last 90 days of positive ledger events. Gmail-source rows are direction-
 * coded via metadata.direction ("sent" | "received"). Chat + manual
 * sources default to operator-initiated since the operator authors chat.
 *
 * Returns null when the sample is thin (<5 events) · the surface
 * shouldn't render a misleading ratio off 1-2 data points.
 *
 * Pure read · no side effects · cron writes the result into
 * PersonProfile.metadata.reciprocity (no schema column needed).
 */

import "server-only";
import { prisma } from "@/lib/prisma";

export interface ReciprocitySnapshot {
  operatorInitiatedPct: number;
  theirInitiatedPct: number;
  sampleSize: number;
}

/**
 * Compute the 90d reciprocity gradient for a person.
 * @returns null when fewer than 5 positive ledger events found.
 */
export async function computeReciprocity(
  personId: string,
): Promise<ReciprocitySnapshot | null> {
  const since = new Date(Date.now() - 90 * 86400_000);
  const events = await prisma.relationshipLedger.findMany({
    where: {
      personId,
      createdAt: { gte: since },
      amount: { gte: 0 }, // positive only · deposits = touchpoints
    },
    select: { source: true, metadata: true },
  });
  if (events.length < 5) return null;

  let operatorInit = 0;
  let theirInit = 0;
  for (const ev of events) {
    if (ev.source === "gmail") {
      const meta = ev.metadata as { direction?: "sent" | "received" } | null;
      if (meta?.direction === "sent") operatorInit++;
      else if (meta?.direction === "received") theirInit++;
      else operatorInit++; // unknown direction · default operator-initiated
    } else if (ev.source === "chat" || ev.source === "manual") {
      operatorInit++; // operator-authored by definition
    } else {
      operatorInit++; // default assumption for unknown sources
    }
  }
  const total = operatorInit + theirInit || 1;
  return {
    operatorInitiatedPct: Math.round((operatorInit / total) * 100),
    theirInitiatedPct: Math.round((theirInit / total) * 100),
    sampleSize: events.length,
  };
}
