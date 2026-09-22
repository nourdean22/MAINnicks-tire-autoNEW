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
 * the live deps (loadPriorRecommendations, assessTurnRisk, recordMetricStrict,
 * and the system_metrics dedupe read behind `alreadyRecorded`) are supplied at
 * the call site; tests/services/chat/novelty-shadow-wiring.test.ts pins that
 * binding on comment-stripped source.
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
// Type-only: erased at runtime, so this module stays prisma-free. The type is
// the guard — see NoveltyShadowDeps.recordMetric.
import type { MetricWriteReceipt } from "@/lib/services/metrics";

export const RECOMMENDATION_NOVELTY_METRIC = "recommendation.novelty";

export type NoveltyShadowOutcome =
  /** The turn asked for resources, named at least one, and the verdict was recorded. */
  | "recorded"
  /** The turn did not ask for named resources; nothing to judge. */
  | "skipped_not_resource_turn"
  /**
   * A row for this traceId already exists. The post-turn outbox REPLAYS
   * runDeferredBackgroundWork after a crash or an unmarked completion; a
   * second observation of the same turn would inflate writesInWindow, cross
   * MIN_POWERED_N early and bias every rate read off these rows.
   */
  | "skipped_already_recorded"
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
  /**
   * The persisted row of the reply being judged, or null when persist skipped
   * it. The shadow runs AFTER persist, so a prior scan that does not exclude
   * this row finds every name the draft used in the draft itself and calls
   * all of them repeats — the normal path would have been systematically
   * false (review on PR #2485).
   */
  createdAssistantId: string | null;
}

export interface NoveltyShadowDeps {
  /** `assessTurnRisk(userContent, …).signals.expectsNamedResources` at the live site. */
  expectsNamedResources: (userContent: string) => boolean;
  /**
   * `loadPriorRecommendations` at the live site. Receives the id to exclude
   * so the exclusion is this module's contract (unit-tested), not a detail
   * of how the caller happened to bind the loader.
   */
  loadPriors: (options: {
    excludeMessageId: string | null;
  }) => Promise<{ priors: readonly PriorRecommendation[]; provenance: "OK" | "ZERO" | "ERROR" }>;
  /**
   * Has this traceId already been recorded under RECOMMENDATION_NOVELTY_METRIC?
   * Checked BEFORE priors are loaded, so a replay costs one indexed read and
   * no scan. Required, not optional: forgetting it at a call site must be a
   * type error, because the failure it prevents is invisible in the data.
   */
  alreadyRecorded: (traceId: string) => Promise<boolean>;
  /**
   * Must PROPAGATE a write failure — pass `recordMetricStrict`, never the
   * fail-soft `recordMetric`. Same rule as the Done shadow: a dead writer must
   * read as broken, not as "no repeats". The receipt type is the enforcement:
   * `recordMetric` returns Promise<void>, which is not assignable here, so a
   * wiring change that swaps in the fail-soft writer fails `tsc` instead of
   * silently disabling the failure branch below.
   */
  recordMetric: (
    metric: string,
    value: number,
    options: { unit?: string; tags?: Record<string, unknown>; source?: string },
  ) => Promise<MetricWriteReceipt>;
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
    // Idempotent by traceId — see NoveltyShadowOutcome "skipped_already_recorded".
    // Inside the try on purpose: a broken dedupe reader must surface as a
    // FAILING instrument, not fall through to a second write.
    if (await deps.alreadyRecorded(args.traceId)) {
      deps.logInfo?.("recommendation_novelty_shadow_skipped", {
        traceId: args.traceId,
        reason: "already_recorded",
      });
      return "skipped_already_recorded";
    }

    const { priors, provenance } = await deps.loadPriors({
      excludeMessageId: args.createdAssistantId,
    });
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
