/**
 * v10.0.524 · GET /api/system/eval-results
 *
 * Returns the latest N regression-runner reports, sourced from
 * BrainMemory(category="eval_result"). Owner-only — eval data exposes
 * pipeline weak spots + would be a useful target map for an attacker.
 *
 * Powers the operator dashboard card (components/system/
 * eval-regression-card.tsx) and any future "trend over time" graphs.
 *
 * Query params:
 *   ?limit=N   how many rows to return (default 14, max 90 = ~3 months)
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

const DEFAULT_LIMIT = 14;
const MAX_LIMIT = 90;
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
  worstCategories?: Array<{ category: string; failed: number; total: number }>;
  perQuestionResults?: PerQuestionMeta[];
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
    );

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
        // perQuestionResults is heavy · only ship it if the caller
        // asked for a single row (drill-down view). Otherwise omit
        // to keep the trend payload tight.
        perQuestionResults:
          limit === 1 ? meta.perQuestionResults ?? [] : undefined,
      };
    });

    return { results, count: results.length };
  },
  { auth: "owner" },
);
