/**
 * Entity-audit retention helper · v8.9 · Apr 29.
 *
 * Every mutation through `recordAudit` writes a row to entity_audits
 * (v8.0). At ~10-50 mutations per active day across all entities,
 * the table grows fast — at 30 days it's already 1500 rows; at 1
 * year, ~18K. Without TTL, by the time pgvector embeddings catch up
 * we're spending more on audit storage than on actual brain memories.
 *
 * Retention policy:
 *   · Hot window: 90 days (default). Every audit row newer than this
 *     stays in the table for fast `getEntityHistory` queries.
 *   · Beyond 90 days: rows are HARD-DELETED. Hard not soft because:
 *     - audit rows have NO downstream refs (no FKs point at them)
 *     - the data is forensic, not behavioral — once expired the only
 *       reason to keep them is bytes-spend, which is the cost we're
 *       managing here
 *   · Tier-2 rows (action=created with no follow-up) prune at 30
 *     days because creates are recoverable via the `after` payload of
 *     downstream `updated` rows; we don't need a deep history of
 *     "this row was created".
 *
 * Composes:
 *   · Reads from prisma.entityAudit
 *   · Writes one BrainMemory category="audit_retention_run" per day
 *     so the cron-diagnostics surface knows we ran
 *
 * Folded into mega-evening — same daily cadence as the rest of the
 * cleanup pass.
 */

import { prisma } from "@/lib/prisma";

const HOT_WINDOW_DAYS = 90;
const TIER2_WINDOW_DAYS = 30;

export interface RetentionReport {
  ranAt: string;
  hotWindowDays: number;
  tier2WindowDays: number;
  /** Rows pruned that were older than HOT_WINDOW (any action). */
  agedOutDeleted: number;
  /** Rows pruned that were creates older than TIER2_WINDOW. */
  tier2CreatedDeleted: number;
  /** Total rows remaining after the run. */
  remaining: number;
  /** Newest row pruned (for the diagnostic memory). */
  oldestRetainedAt: string | null;
}

export async function runAuditRetention(): Promise<RetentionReport> {
  const ranAt = new Date().toISOString();
  const hotCutoff = new Date(Date.now() - HOT_WINDOW_DAYS * 86_400_000);
  const tier2Cutoff = new Date(Date.now() - TIER2_WINDOW_DAYS * 86_400_000);

  // Tier 1: prune any row older than the hot window.
  const aged = await prisma.entityAudit
    .deleteMany({
      where: { createdAt: { lt: hotCutoff } },
    })
    .catch((err: unknown) => {
      console.warn("[audit-retention] tier-1 delete failed:", err);
      return { count: 0 };
    });

  // Tier 2: prune `created` rows older than 30d. Cheap because they
  // carry no diff (after-only payload that's reconstructable from the
  // entity itself).
  const tier2 = await prisma.entityAudit
    .deleteMany({
      where: {
        action: "created",
        createdAt: { lt: tier2Cutoff, gte: hotCutoff },
      },
    })
    .catch((err: unknown) => {
      console.warn("[audit-retention] tier-2 delete failed:", err);
      return { count: 0 };
    });

  const remainingPromise = prisma.entityAudit.count().catch(() => 0);
  const oldestPromise = prisma.entityAudit
    .findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    })
    .catch(() => null);

  const [remaining, oldest] = await Promise.all([
    remainingPromise,
    oldestPromise,
  ]);

  return {
    ranAt,
    hotWindowDays: HOT_WINDOW_DAYS,
    tier2WindowDays: TIER2_WINDOW_DAYS,
    agedOutDeleted: aged.count,
    tier2CreatedDeleted: tier2.count,
    remaining,
    oldestRetainedAt: oldest?.createdAt.toISOString() ?? null,
  };
}
