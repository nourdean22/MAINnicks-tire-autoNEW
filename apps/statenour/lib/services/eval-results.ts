/**
 * lib/services/eval-results.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * The nightly eval-regression-runner report reader. Lifted verbatim
 * from app/api/system/eval-results/route.ts so the legacy REST endpoint
 * AND the new `system.evalResults` tRPC procedure call the same
 * function · drift between consumers structurally impossible.
 *
 * Source: BrainMemory(category="eval_result"). `perQuestionResults`
 * is heavy and only shipped when the caller asks for a single row
 * (the drill-down view).
 */

import { prisma } from "@/lib/prisma";

const MEMORY_CATEGORY = "eval_result";

interface PerQuestionMeta {
  id: string;
  category: string;
  passed: boolean;
  score: number;
  failures: string[];
  replyPreview: string;
  toolCalls: string[];
  durationMs: number;
  pipelineError?: string;
}

interface EvalResultMeta {
  ranAt?: string;
  totalRan?: number;
  passed?: number;
  failed?: number;
  passRate?: number;
  scoreAvg?: number;
  durationMs?: number;
  worstCategories?: Array<{
    category: string;
    failed: number;
    total: number;
  }>;
  perQuestionResults?: PerQuestionMeta[];
}

/** Latest N regression-runner reports, newest first. */
export async function listEvalResults(limit: number) {
  const rows = await prisma.brainMemory.findMany({
    where: { category: MEMORY_CATEGORY, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      key: true,
      content: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const results = rows.map((r) => {
    const meta = (r.metadata ?? {}) as EvalResultMeta;
    return {
      id: r.id,
      key: r.key,
      summary: r.content,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      ranAt: meta.ranAt ?? r.createdAt.toISOString(),
      totalRan: meta.totalRan ?? 0,
      passed: meta.passed ?? 0,
      failed: meta.failed ?? 0,
      passRate: meta.passRate ?? 0,
      scoreAvg: meta.scoreAvg ?? 0,
      durationMs: meta.durationMs ?? 0,
      worstCategories: meta.worstCategories ?? [],
      // perQuestionResults is heavy · only ship it if the caller asked
      // for a single row (drill-down view). Otherwise omit to keep the
      // trend payload tight.
      perQuestionResults:
        limit === 1 ? meta.perQuestionResults ?? [] : undefined,
    };
  });

  return { results, count: results.length };
}
