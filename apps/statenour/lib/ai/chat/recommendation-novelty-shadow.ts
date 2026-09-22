/**
 * Records the recommendation-novelty SHADOW verdict. Shadow only — this changes
 * no behaviour, it makes the operator's most-stated complaint measurable.
 *
 * WHY IT EXISTS. The 2026-09-10 audit ("Huberman, Naval, Goggins, Daily Stoic
 * showed up three separate times in one session") produced two halves:
 * `loadPriorRecommendations` + `buildPriorRecommendationsBlock` inject what was
 * already recommended into the system prompt (LIVE, app/api/ai/chat/route.ts),
 * and `checkNovelty(draft, priors)` compares a DRAFT REPLY against those priors
 * (pure, tested). Measured 2026-09-22: `checkNovelty` and `buildNoveltyBlock`
 * have ZERO callers outside their module. The half that can see whether the
 * prompt injection actually worked was never wired. So "did Nick repeat
 * himself" has been an opinion for twelve days while the instrument sat built.
 *
 * The repair-signal harvest (harvest-repair-signals.ts) found exactly one
 * explicit repetition complaint in 2,795 operator messages. That is not
 * evidence repetition is rare; it is evidence the operator rarely types the
 * complaint. This is the instrument that does not depend on him typing it.
 *
 * WHY IT IS A MODULE AND NOT AN INLINE BLOCK. Same reason as
 * action-done-shadow-recorder.ts: its caller is runDeferredBackgroundWork, a
 * ~700-line function with no harness. Extracted and dependency-injected, the
 * contract below is directly assertable, and the module stays prisma-free —
 * the live deps (loadPriorRecommendations, assessTurnRisk, recordMetricStrict)
 * are supplied at the call site.
 *
 * EMPTY IS NOT ERROR. `loadPriorRecommendations` returns `provenance: "ERROR"`
 * with an empty list when the lookup failed. Scoring a draft against an empty
 * prior set would report every name as fresh — a novelty instrument that lies
 * in the exact direction the audit complained about. That case is an outcome
 * of its own and is never recorded as a verdict.
 */
import { checkNovelty, type NoveltyReport, type PriorRecommendation } from "./recommendation-novelty";
// Prisma-free helper module on purpose — see lib/observability/instrument-scope.ts.
import { instrumentScope } from "@/lib/observability/instrument-scope";

export const RECOMMENDATION_NOVELTY_METRIC = "recommendation.novelty";

export type NoveltyShadowOutcome =
  /** The turn asked for resources, named at least one, and the verdict was recorded. */
  | "recorded"
  /** The turn did not ask for named resources; nothing to judge. */
  | "skipped_not_resource_turn"
  /** A resource turn whose reply named nothing (e.g. it asked a question back). */
  | "skipped_no_names"
  /** Priors could not be loaded — scoring against nothing would read as "all fresh". */
  | "skipped_priors_unavailable"
  /** The instrument itself failed. Never silently. */
  | "failed";

export interface NoveltyShadowArgs {
  userContent: string;
  cleanedText: string;
  traceId: string;
  conversationId: string | null;
}

export interface NoveltyShadowDeps {
  /** `assessTurnRisk(userContent, …).signals.expectsNamedResources` at the live site. */
  expectsNamedResources: (userContent: string) => boolean;
  /** `loadPriorRecommendations` at the live site. */
  loadPriors: () => Promise<{ priors: readonly PriorRecommendation[]; provenance: "OK" | "ZERO" | "ERROR" }>;
  /**
   * Must PROPAGATE a write failure — pass `recordMetricStrict`, never the
   * fail-soft `recordMetric`. Same rule as the Done shadow: a dead writer must
   * read as broken, not as "no repeats".
   */
  recordMetric: (
    metric: string,
    value: number,
    options: { unit?: string; tags?: Record<string, unknown>; source?: string },
  ) => Promise<unknown>;
  logInfo?: (event: string, data: Record<string, unknown>) => void;
  logError?: (scope: string, err: unknown, meta: Record<string, unknown>) => void;
  now?: () => Date;
}

/** Cap list-valued tags so one enormous reply cannot bloat a metric row. */
const TAG_LIST_CAP = 20;

export function summarizeForTags(report: NoveltyReport): Record<string, unknown> {
  return {
    considered: report.considered,
    freshCount: report.fresh.length,
    repeatCount: report.repeats.length,
    allRepeats: report.allRepeats,
    fresh: report.fresh.slice(0, TAG_LIST_CAP),
    repeats: report.repeats.slice(0, TAG_LIST_CAP),
  };
}

export async function recordRecommendationNoveltyShadow(
  args: NoveltyShadowArgs,
  deps: NoveltyShadowDeps,
): Promise<NoveltyShadowOutcome> {
  if (!deps.expectsNamedResources(args.userContent)) return "skipped_not_resource_turn";

  try {
    const { priors, provenance } = await deps.loadPriors();
    if (provenance === "ERROR") {
      deps.logInfo?.("recommendation_novelty_shadow_skipped", {
        traceId: args.traceId,
        reason: "priors_unavailable",
      });
      return "skipped_priors_unavailable";
    }

    const report = checkNovelty(args.cleanedText, priors, deps.now?.() ?? new Date());
    if (report.considered === 0) return "skipped_no_names";

    deps.logInfo?.("recommendation_novelty_shadow", {
      traceId: args.traceId,
      considered: report.considered,
      repeats: report.repeats.length,
      allRepeats: report.allRepeats,
      provenance,
    });

    // value = number of re-served names. 0 is a real reading ("all fresh"),
    // which is exactly why ERROR provenance is excluded above.
    await deps.recordMetric(RECOMMENDATION_NOVELTY_METRIC, report.repeats.length, {
      unit: "count",
      source: "recommendation-novelty-shadow",
      tags: {
        traceId: args.traceId,
        conversationId: args.conversationId,
        provenance,
        ...summarizeForTags(report),
      },
    });
    return "recorded";
  } catch (err) {
    // NOT a silent catch — same discipline as the Done shadow. The scope MUST
    // be the shared instrument scope so `buildInstrumentFailures()` can name
    // this instrument, and `buildInstrumentHealth()` can rank it FAILING.
    // LITERAL, not the constant: the producer canary in
    // tests/lib/observability/instrument-failures.test.ts scans source for
    // `instrumentScope("<name>")` and cannot resolve a constant. A producer it
    // cannot see is an instrument that reads as healthy forever.
    deps.logError?.(instrumentScope("recommendation.novelty"), err, {
      stage: "record-novelty-shadow",
      traceId: args.traceId,
    });
    return "failed";
  }
}
