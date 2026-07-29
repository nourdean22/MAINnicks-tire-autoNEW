/**
 * lib/ai/judge-eval/persistence.ts · Phase V (2026-05-18 PM)
 *
 * Stores prompt-comparison runs as BrainMemory rows (category
 * PROMPT_COMPARISON_RUN) so the /system/judge-eval dashboard can
 * aggregate over them. Using BrainMemory instead of a dedicated
 * table avoids a schema migration this phase · the row shape is
 * stable and the query patterns are simple aggregations.
 *
 * Each row stores:
 *   · prompt (truncated to 500 chars in content for browseability)
 *   · the full v1Reply / v2Reply / Judgment in metadata JSON
 *   · winner + v2Score promoted to top-level metadata fields for
 *     fast aggregation (avoids JSON path queries)
 *   · intentClass tag for per-intent breakdowns
 */

import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";
import type { Judgment, Winner } from "./comparator";

const log = rootLogger.withSurface("ai/judge-eval/persistence");

export interface RecordComparisonArgs {
  prompt: string;
  v1Reply: string;
  v2Reply: string;
  judgment: Judgment;
  /** Optional · used for per-intent aggregation in the dashboard. */
  intentClass?: string;
  /** Optional · Phase W · ChatMessage.id this comparison came from.
   *  Lets the sampler skip already-compared rows so the operator
   *  doesn't duplicate work. */
  sourceMessageId?: string;
}

export interface ComparisonRow {
  id: string;
  prompt: string;
  v1Reply: string;
  v2Reply: string;
  judgment: Judgment;
  intentClass: string | null;
  /** Wave-5 · the operator's binary verdict, null until labeled. */
  operatorWinner: Winner | null;
  createdAt: string;
}

/**
 * Record a comparison run. Best-effort · returns null on persistence
 * failure (caller decides whether to surface the error or swallow).
 */
export async function recordComparison(args: RecordComparisonArgs): Promise<string | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const id = `comparison_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // JSON round-trip · coerces the typed Judgment shape into the
    // InputJsonValue type Prisma's metadata field accepts (same
    // pattern as N.4 idempotency.ts storeIdempotencyResult).
    const metadataJson = JSON.parse(
      JSON.stringify({
        prompt: args.prompt,
        v1Reply: args.v1Reply,
        v2Reply: args.v2Reply,
        judgment: args.judgment,
        // Promoted for fast aggregation (avoids JSON path queries)
        winner: args.judgment.winner,
        v2Score: args.judgment.v2Score,
        intentClass: args.intentClass ?? null,
        sourceMessageId: args.sourceMessageId ?? null,
        parsed: args.judgment.parsed,
      }),
    );
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.PROMPT_COMPARISON_RUN,
        key: id,
        // Browseable content snapshot · full reply text lives in metadata
        content: `[${args.judgment.winner.toUpperCase()} v2Score=${args.judgment.v2Score}] ${args.prompt.slice(0, 500)}`,
        confidence: args.judgment.v2Score / 100,
        source: "judge-eval",
        createdBy: "system",
        metadata: metadataJson,
      },
    });
    return id;
  } catch (e) {
    log.warn("comparison_persist_failed", { err: (e as Error).message?.slice(0, 200) });
    return null;
  }
}

/**
 * Read recent comparison runs. Returns newest-first.
 * `take` defaults to 500 · matches scorePersonas() lookback default.
 */
export async function readComparisons(
  options?: { take?: number; sinceDays?: number },
): Promise<ComparisonRow[]> {
  const take = options?.take ?? 500;
  const sinceDays = options?.sinceDays;

  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.PROMPT_COMPARISON_RUN,
        deletedAt: null,
        ...(sinceDays
          ? { createdAt: { gte: new Date(Date.now() - sinceDays * 86_400_000) } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      select: { key: true, metadata: true, createdAt: true },
    });

    return rows.flatMap((r): ComparisonRow[] => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const prompt = typeof m.prompt === "string" ? m.prompt : "";
      const v1Reply = typeof m.v1Reply === "string" ? m.v1Reply : "";
      const v2Reply = typeof m.v2Reply === "string" ? m.v2Reply : "";
      const judgment = m.judgment as Judgment | undefined;
      const intentClass = typeof m.intentClass === "string" ? m.intentClass : null;

      if (!judgment) return [];
      const ow = m.operatorWinner;
      return [
        {
          id: r.key,
          prompt,
          v1Reply,
          v2Reply,
          judgment,
          intentClass,
          operatorWinner: ow === "v1" || ow === "v2" || ow === "tie" ? ow : null,
          createdAt: r.createdAt.toISOString(),
        },
      ];
    });
  } catch (e) {
    log.warn("comparison_read_failed", { err: (e as Error).message?.slice(0, 200) });
    return [];
  }
}

/**
 * Wave-5 (2026-07-29) · operator binary label on a judged comparison —
 * the calibration ground truth. 30-100 such labels are enough to trust
 * or distrust the judge (Husain/Braintrust practice); waiting for
 * "enough samples" without labels was the trap. Stored into the SAME
 * row's metadata (operatorWinner + labeledAt) — no migration.
 */
export async function recordOperatorLabel(
  id: string,
  operatorWinner: Winner,
): Promise<boolean> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.brainMemory.findFirst({
      where: { category: BRAIN_CATEGORIES.PROMPT_COMPARISON_RUN, key: id, deletedAt: null },
      select: { id: true, metadata: true },
    });
    if (!row) return false;
    const merged = {
      ...((row.metadata ?? {}) as Record<string, unknown>),
      operatorWinner,
      labeledAt: new Date().toISOString(),
    };
    await prisma.brainMemory.update({
      where: { id: row.id },
      data: { metadata: merged as never },
    });
    return true;
  } catch (e) {
    log.warn("operator_label_failed", { err: (e as Error).message?.slice(0, 200) });
    return false;
  }
}

/**
 * Promoted-metadata view used by the summary aggregator · the full
 * reply text is heavy so the summary path reads only winner +
 * v2Score + intentClass.
 */
export interface ComparisonHead {
  winner: Winner;
  v2Score: number;
  intentClass: string | null;
  createdAt: string;
}

export async function readComparisonHeads(
  options?: { sinceDays?: number; take?: number },
): Promise<ComparisonHead[]> {
  const take = options?.take ?? 2000;
  const sinceDays = options?.sinceDays;

  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.PROMPT_COMPARISON_RUN,
        deletedAt: null,
        ...(sinceDays
          ? { createdAt: { gte: new Date(Date.now() - sinceDays * 86_400_000) } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      select: { metadata: true, createdAt: true },
    });

    return rows.flatMap((r): ComparisonHead[] => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const winner = m.winner;
      if (winner !== "v1" && winner !== "v2" && winner !== "tie") return [];
      const v2Score = typeof m.v2Score === "number" ? m.v2Score : 50;
      return [
        {
          winner,
          v2Score,
          intentClass: typeof m.intentClass === "string" ? m.intentClass : null,
          createdAt: r.createdAt.toISOString(),
        },
      ];
    });
  } catch (e) {
    log.warn("comparison_heads_failed", { err: (e as Error).message?.slice(0, 200) });
    return [];
  }
}
