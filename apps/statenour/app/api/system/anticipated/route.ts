/**
 * GET /api/system/anticipated · v10.0.526 · Arc B Feature 6
 *
 * Owner-gated read of today's anticipated-question feed. Powers the
 * future Ultron tile that surfaces:
 *   · The 3 questions Nick predicted the operator would ask today
 *   · Which precomputes succeeded (hasAnswer flag)
 *   · How fresh the set is (built-at timestamp)
 *
 * Read-only · no mutation, no AI cost. The freshness gate stays
 * permissive here (`allowStale: true` via direct read) so the UI can
 * show even stale predictions with a "stale" indicator.
 */

import { apiHandler } from "@/lib/utils/http";
import { getTodaysAnticipated, todayKey } from "@/lib/brain/anticipated-questions";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(
  async () => {
    const today = todayKey();
    const set = await getTodaysAnticipated();

    // Also pull yesterday's set so the UI can show "yesterday's
    // predictions vs today's" without a second roundtrip. Helps the
    // operator eyeball whether the predictor's stable across days.
    const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const yesterdayRow = await prisma.brainMemory
      .findUnique({
        where: {
          category_key: {
            category: "anticipated_question",
            key: `anticipated_${yesterdayDate}`,
          },
        },
        select: { metadata: true, updatedAt: true },
      })
      .catch(() => null as { metadata: unknown; updatedAt: Date } | null);

    let yesterday: unknown = null;
    if (yesterdayRow && yesterdayRow.metadata) {
      const meta = yesterdayRow.metadata as Record<string, unknown>;
      if (Array.isArray(meta.questions)) yesterday = meta;
    }

    const ageHours = set
      ? (Date.now() - new Date(set.builtAt).getTime()) / (60 * 60 * 1000)
      : null;

    return {
      today: {
        date: today,
        exists: set != null,
        empty: set != null && set.questions.length === 0,
        builtAt: set?.builtAt ?? null,
        ageHours: ageHours != null ? Math.round(ageHours * 10) / 10 : null,
        fresh: ageHours != null && ageHours < 24,
        // v10.0.529.40 · normalized question shape · always returns
        // { text, topic, confidence } so the UI doesn't have to
        // handle both legacy-string and new-object shapes. Legacy
        // rows (pre-confidence) get confidence=1 implicitly.
        questions: set
          ? set.questions.map((q) => {
              if (typeof q === "string") {
                return { text: q, topic: null, confidence: 1 };
              }
              const obj = q as { question?: string; topic?: string | null; confidence?: number };
              return {
                text: typeof obj.question === "string" ? obj.question : String(q),
                topic: obj.topic ?? null,
                confidence: typeof obj.confidence === "number" ? obj.confidence : 1,
              };
            })
          : [],
        // We surface a flag (not the full answer) so the tile can show
        // "ready" without bloating the response. The chat-injection
        // path is the read-of-record for the answer itself.
        readiness: set
          ? set.answers.map((a) => ({ ready: a != null, chars: a?.length ?? 0 }))
          : [],
      },
      yesterday,
    };
  },
  { auth: "owner" },
);
