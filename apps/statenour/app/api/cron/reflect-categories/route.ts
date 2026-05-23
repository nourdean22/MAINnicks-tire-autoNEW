/**
 * GET /api/cron/reflect-categories · CoALA per-category reflection
 * synthesis (task #12 · 2026-05-23).
 *
 * Iterates over a small whitelist of source categories that benefit
 * from cross-cutting synthesis (raw observations that should compound
 * into higher-level patterns). For each, calls
 * `reflectOnCategory(category)` which:
 *   1. Pulls last-7d BrainMemory rows of that category.
 *   2. Skips if <5 rows (insufficient signal).
 *   3. Skips if a same-category reflection ran in the last 24h.
 *   4. Synthesizes 3-5 insights via the aiChat provider chain.
 *   5. Persists each as a new `reflection`-category BrainMemory row.
 *
 * Distinct from /api/cron/reflect (the daily/weekly cross-table
 * engine that writes to the `Reflection` table). This one writes
 * BrainMemory rows · they show up in the standard recall pipeline.
 *
 * Suggested Vercel cron schedule: weekly · "0 3 * * 0" (Sunday 03:00).
 * Operator can also trigger ad-hoc via tRPC `brain.reflect`.
 */

import { cronHandler } from "@/lib/utils/http";
import { reflectOnCategory, type ReflectionResult } from "@/lib/services/reflection";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const maxDuration = 300;

/**
 * Source categories to reflect on. Picked from BRAIN_CATEGORIES for
 * density of "raw observations that benefit from synthesis":
 *
 *   · decision_log     — individual decisions → "you keep choosing X under Y"
 *   · pattern          — observed patterns → "these three patterns share Z"
 *   · belief           — held beliefs → "these beliefs all assume W"
 *   · lesson           — captured lessons → "the recurring lesson is V"
 *   · learning_journal — journal entries → "this week you kept circling on U"
 *   · task_insight     — per-task observations → "your task patterns share T" (task #17)
 *   · task_pattern     — synthesized task patterns → "the morning-routine theme is S" (task #17)
 *
 * Skipped intentionally:
 *   · domain_knowledge — already curated facts, not raw observations
 *   · wisdom           — already meta-tier, reflecting on reflections drifts
 *   · reflection       — never reflect on reflections (would compound noise)
 *   · orphan_tasks_nudge — UI-side nudge marker, not signal for synthesis
 */
export const REFLECT_CATEGORIES: readonly string[] = [
  BRAIN_CATEGORIES.DECISION_LOG,
  BRAIN_CATEGORIES.PATTERN,
  BRAIN_CATEGORIES.BELIEF,
  BRAIN_CATEGORIES.LESSON,
  BRAIN_CATEGORIES.LEARNING_JOURNAL,
  // ── task #17 · task-pattern reflection layer ──
  BRAIN_CATEGORIES.TASK_INSIGHT,
  BRAIN_CATEGORIES.TASK_PATTERN,
];

interface CategoryRunSummary {
  ran: boolean;
  insightsWritten: number;
  skipped: ReflectionResult["skipped"] | null;
  error?: string;
}

export const GET = cronHandler(async () => {
  let ran = 0;
  let skipped = 0;
  let insightsWritten = 0;
  const byCategory: Record<string, CategoryRunSummary> = {};

  for (const category of REFLECT_CATEGORIES) {
    try {
      const result = await reflectOnCategory({ category });
      byCategory[category] = {
        ran: result.skipped == null,
        insightsWritten: result.insightsWritten,
        skipped: result.skipped ?? null,
      };
      if (result.skipped) {
        skipped += 1;
      } else {
        ran += 1;
        insightsWritten += result.insightsWritten;
      }
    } catch (err) {
      byCategory[category] = {
        ran: false,
        insightsWritten: 0,
        skipped: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    ok: true,
    ran,
    skipped,
    insightsWritten,
    byCategory,
    summary: `${ran} ran · ${skipped} skipped · ${insightsWritten} insights written`,
  };
});

export const POST = GET;
