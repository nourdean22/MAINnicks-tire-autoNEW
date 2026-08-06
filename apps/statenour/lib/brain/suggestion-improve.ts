/**
 * lib/brain/suggestion-improve.ts · 2026-05-21
 *
 * Closes the suggestion-loop feedback loop · turns the operator's
 * act/dismiss reactions to Nick's proactive suggestion chips into
 * per-kind improvement hypotheses the operator can act on.
 *
 * Sibling of improve-agent.ts (which does the same for reply_judgment
 * scores). Kept a separate module by design — see
 * docs/suggestion-improve-design.md, decision D6. improve-agent.ts is
 * untouched.
 *
 * Pipeline:
 *   1. suggestionLoopStats() · per-kind act/dismiss tallies (last 30d)
 *   2. For each kind with >= MIN_SIGNALS action signals, compute the
 *      dismiss rate
 *   3. Flag kinds whose dismissRate >= NOISY_DISMISS_RATE as "noisy"
 *   4. Persist one `suggestion_hypothesis` brain memory per noisy kind
 *
 * Output is OPERATOR-FACING · no auto-tuning of the /api/nick/suggest
 * aggregator. Hypotheses surface on /brain/wisdom · the operator
 * decides whether to retune.
 *
 * Run: via the brain-feedback-loop cron, alongside runImproveAgent.
 */

import { suggestionLoopStats } from "@/lib/brain/suggestion-loop";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

/** A kind needs at least this many action signals before it is judged. */
const MIN_SIGNALS = 5;
/** dismissRate at or above this flags the kind as noisy. */
const NOISY_DISMISS_RATE = 0.5;
/** Analysis window (days). Matches suggestionLoopStats' own default. */
const DEFAULT_DAYS = 30;

export interface SuggestionHypothesis {
  kind: string;
  /** acted + dismissed + modified + deferred in the window. */
  signalCount: number;
  acted: number;
  dismissed: number;
  /** dismissed / signalCount, rounded to 2dp · 0..1. */
  dismissRate: number;
  /** acted / signalCount, rounded to 2dp · 0..1. */
  actionRate: number;
  verdict: "noisy";
  summary: string;
}

/**
 * Read the suggestion-loop stats and emit a hypothesis for every kind
 * the operator is mostly dismissing.
 *
 * "Noisy" keys on dismissRate, not low actionRate: a dismiss is the
 * explicit no, while a deferred signal means the operator is busy, not
 * that the kind is bad — see the design doc.
 */
export async function analyzeSuggestionLoop(
  daysBack = DEFAULT_DAYS,
): Promise<SuggestionHypothesis[]> {
  const stats = await suggestionLoopStats(daysBack);
  const out: SuggestionHypothesis[] = [];

  for (const [kind, b] of Object.entries(stats.byKind)) {
    const signalCount = b.acted + b.dismissed + b.modified + b.deferred;
    if (signalCount < MIN_SIGNALS) continue; // too thin to judge

    const dismissRate = b.dismissed / signalCount;
    if (dismissRate < NOISY_DISMISS_RATE) continue; // landing fine

    const pct = Math.round(dismissRate * 100);
    out.push({
      kind,
      signalCount,
      acted: b.acted,
      dismissed: b.dismissed,
      dismissRate: Math.round(dismissRate * 100) / 100,
      actionRate: Math.round((b.acted / signalCount) * 100) / 100,
      verdict: "noisy",
      summary: `${kind} · ${b.dismissed}/${signalCount} dismissed (${pct}%), acted ${b.acted} — you're rejecting this kind. Review its trigger in /api/nick/suggest: the threshold, or whether to generate it at all.`,
    });
  }

  // Noisiest kind first — highest-impact to retune.
  out.sort((a, b) => b.dismissRate - a.dismissRate);
  return out;
}

/**
 * Persist each hypothesis as a `suggestion_hypothesis` brain memory.
 * Idempotent · keys are stable per kind + day, so re-running the cron
 * rewrites today's rows without polluting the corpus. Per-write
 * best-effort — a single failed write is skipped, not fatal.
 */
export async function persistSuggestionHypotheses(
  hypotheses: SuggestionHypothesis[],
): Promise<number> {
  if (hypotheses.length === 0) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const { brainMemory } = await import("@/lib/brain/memory-manager");
  let written = 0;
  let failures = 0;
  const writeErrors: unknown[] = [];
  for (const h of hypotheses) {
    const key = `suggestion_hyp_${h.kind}_${today}`;
    try {
      await brainMemory.remember(
        BRAIN_CATEGORIES.SUGGESTION_HYPOTHESIS,
        key,
        h.summary,
        "suggestion-improve",
        {
          kind: h.kind,
          signalCount: h.signalCount,
          acted: h.acted,
          dismissed: h.dismissed,
          dismissRate: h.dismissRate,
          actionRate: h.actionRate,
          verdict: h.verdict,
          windowDate: today,
        },
      );
      written++;
    } catch (err) {
      // best-effort · skip
      failures++;
      writeErrors.push(err);
    }
  }
  if (failures > 0) {
    logError("brain.suggestion-improve", new Error(`${failures} hypothesis writes failed`), { fn: "persistSuggestionHypotheses", errors: writeErrors.map(String) });
  }
  return written;
}

/**
 * One-shot · analyze then persist.
 *
 * Wrapped in a top-level try/catch returning an empty result — a failure
 * here must never take down its caller. Call site: the weekly
 * `suggestion-improve-weekly` Inngest function (wired 2026-08-05; this
 * module had ZERO importers before that, despite an earlier comment here
 * claiming it ran in the brain-feedback-loop cron).
 */
export async function runSuggestionImproveAgent(daysBack = DEFAULT_DAYS): Promise<{
  hypotheses: SuggestionHypothesis[];
  persisted: number;
}> {
  try {
    const hypotheses = await analyzeSuggestionLoop(daysBack);
    const persisted = await persistSuggestionHypotheses(hypotheses);
    return { hypotheses, persisted };
  } catch (err) {
    logError("brain.suggestion-improve", err, { fn: "runSuggestionImproveAgent" });
    return { hypotheses: [], persisted: 0 };
  }
}
