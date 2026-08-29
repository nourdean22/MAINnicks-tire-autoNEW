/**
 * What the operator is TOLD when he judges a discovery cluster (2026-08-28).
 *
 * THE DEFECT THIS EXISTS FOR. `judge()` in discover-tab.tsx spoke only on two
 * exception paths — a partially-consolidated cluster, or more rows rated than
 * the card showed. On the ordinary path, the tap that suppresses six rows
 * produced NO message: the card vanished and nothing said what had happened.
 * An invisible effect is indistinguishable from no effect, which is precisely
 * the complaint the whole verdict loop exists to answer. Worse, the one
 * informational message it did emit rode `actionError` and rendered in error
 * amber, so "we found more copies for you" read as a failure.
 *
 * Pure by design: no React, no tRPC, no DOM. The message the operator sees is
 * the behaviour under test, so it lives where a test can assert it directly
 * rather than through a mocked mutation.
 *
 * EVERY STRING HERE IS A CLAIM ABOUT WHAT THE SYSTEM DOES, and each is true as
 * of #1968 (docs/LEARNING-LOOPS-2026-08-28.md):
 *   · known / noise suppress the whole cluster AND the twins the nightly
 *     engines regenerate — the feed-time judged-identity join in
 *     discoveries.ts, plus filterJudgedBlindSpots() removing them from Nick's
 *     getBlindSpots tool and the Ultron board.
 *   · a `noise` row becomes a label-bearing retrieval eval case
 *     (caseFromNoiseDiscovery in recall-corpus-builder.ts — forbiddenKeys is
 *     the judged row's own key).
 *   · `investigate` opens a task in the inbox mission on the first flip.
 * If one of those stops being true, the sentence here has to change with it.
 */

export type DiscoverVerdict = "investigate" | "known" | "noise";
export type JudgeTone = "info" | "warn" | "error";

export interface JudgeOutcome {
  tone: JudgeTone;
  text: string;
}

export interface JudgeOutcomeInput {
  verdict: DiscoverVerdict;
  /** Rows the server actually rated (it re-derives full cluster membership). */
  rated: number;
  /** Rows that could not be rated — usually consolidated away between render and tap. */
  failed: number;
  /** Rows this card asked to rate. `rated` may exceed it. */
  requested: number;
  /** The mutation threw — nothing was saved. */
  threw?: boolean;
}

/**
 * The trailing note when the server rated MORE rows than the card showed.
 * Informational, never an error: finding extra copies is the cluster feature
 * working, not a fault.
 */
function beyondPageNote(rated: number, requested: number): string {
  const extra = rated - requested;
  if (extra <= 0) return "";
  return ` ${extra} more ${extra === 1 ? "copy was" : "copies were"} found beyond this page.`;
}

export function describeJudgeOutcome(input: JudgeOutcomeInput): JudgeOutcome {
  const { verdict, rated, failed, requested, threw } = input;

  if (threw) {
    return {
      tone: "error",
      text: "That verdict didn't save — the card stays until the server accepts it.",
    };
  }

  // Partial failure keeps its own honest wording and its amber tone: a clean
  // sweep must never be reported over rows that did not take the verdict.
  if (failed > 0) {
    return {
      tone: "warn",
      text: `Saved ${rated} — ${failed} had already been consolidated away.`,
    };
  }

  // Nothing rated and nothing failed: say so rather than claiming a success.
  if (rated <= 0) {
    return { tone: "warn", text: "Nothing was rated — the card is already gone." };
  }

  const extra = beyondPageNote(rated, requested);

  if (verdict === "known") {
    return {
      tone: "info",
      text:
        (rated > 1
          ? `Already knew — suppressed ${rated} similar.`
          : "Already knew — suppressed.") +
        " Copies the engines regenerate stay hidden, and it drops out of Nick's blind-spot surfaces." +
        extra,
    };
  }

  if (verdict === "noise") {
    return {
      tone: "info",
      text:
        (rated > 1 ? `Noise — suppressed ${rated} similar.` : "Noise — suppressed.") +
        " It also becomes a retrieval eval case." +
        extra,
    };
  }

  return {
    tone: "info",
    text:
      (rated > 1 ? `Investigating — ${rated} rows marked.` : "Investigating.") +
      " A task opens in your inbox." +
      extra,
  };
}
