/**
 * Pure verdict logic for the mode probes. Extracted so the part that can LIE is
 * testable without a database.
 *
 * ⚠⚠⚠ READ THIS BEFORE USING `mode` FOR ANYTHING.
 *
 * The `mode` tag on a `tool.surfaced` row is the BUDGET / prompt mode. It is
 * NOT the lane that executed the turn, and it must never be used to infer
 * whether tools were callable.
 *
 * This file's first version did exactly that. It grouped by `mode`, found 74.4%
 * `deep`, and concluded that share of turns took the tool-blind deep path — a
 * conclusion that reached a PR body, agent memory and a spawned task before
 * review caught it. `app/api/ai/chat/alternate-paths.ts` gates that branch on
 *
 *     !multiAgentOn && !mustGate && __deepReasonFlag &&
 *     turnSignal.complexity === "complex" &&
 *     (turnSignal.intent === "decision" || turnSignal.intent === "analytical")
 *
 * and NEVER reads `mode`. The repro turn that motivated the whole finding logged
 * `complexity="simple" intent="factual"` — so `deepOn` was false — while its tag
 * still said `mode="deep"`. The label and the branch shared a word, nothing else.
 *
 * ★ A NAME IS NOT A WIRE. Read the predicate that gates the branch before
 *   attributing behaviour to a label that merely sounds like it.
 *
 * NOTHING currently persists which lane handled a turn, so "could this turn have
 * called a tool?" is unanswerable from the database. These helpers therefore
 * report the budget-mode distribution as a DESCRIPTIVE statistic and refuse the
 * lane inference outright.
 */

/** Below this many OBSERVED chosen rows for a mode, its `named>=1` means nothing. */
export const CHOSEN_COVERAGE_FLOOR = 30;

/** Below this fraction surviving a join, a per-group split describes a subsample. */
export const JOIN_COVERAGE_FLOOR = 0.9;

/**
 * Is there any way to tell, from persisted data, which lane ran a turn?
 * Hard-coded false until something actually records it. Kept as a named export
 * so the day a lane column lands, the compiler-visible thing to flip is obvious
 * and the probes' refusals disappear in one edit rather than by rewording.
 */
export const LANE_ATTRIBUTION_AVAILABLE = false;

/**
 * @param {{ rows: Array<{mode: string, turns: number, with_chosen_row: number,
 *                        observed?: number, named_a_tool: number}>,
 *           total: number, floor?: number }} args
 * @returns {{ deepTurns: number, deepShare: number|null, observedForDeep: number,
 *             chosenIsInformative: boolean, canAttributeLane: boolean,
 *             verdict: "no-deep"|"cannot-attribute-lane"|"partly-refuted" }}
 */
export function classifyModeEvidence(args) {
  const { rows, total } = args;
  const floor = args.floor ?? CHOSEN_COVERAGE_FLOOR;

  const deep = rows.find((r) => r.mode === "deep");
  const deepTurns = deep ? deep.turns : 0;

  // Coverage is counted from the OBSERVED chosen rows FOR DEEP — not the sum of
  // `with_chosen_row` across every mode. Those are two different populations and
  // the sum was wrong twice over: a blind row is explicitly "no measurement"
  // (tool-telemetry-walk.ts classifies it `source: "blind", observed: false`), and
  // a standard-mode row says nothing about deep. Summing them meant 30 blind or
  // 30 standard rows would mark deep's zero "informative" while zero deep
  // receipts existed.
  const observedForDeep = deep ? (deep.observed ?? 0) : 0;
  const chosenIsInformative = observedForDeep >= floor;

  // Share is null rather than 0 when there is nothing to divide by — a 0.0%
  // printed off an empty table is a measured zero.
  const deepShare = total > 0 ? (deepTurns / total) * 100 : null;

  // The floor is ASYMMETRIC on purpose:
  //   "deep NEVER names a tool" — absence of evidence. Needs coverage, or a lane
  //                               that is simply too young reads as proof.
  //   "deep CAN name a tool"    — evidence of presence. ONE counterexample
  //                               settles it; a floor cannot make a real
  //                               observation stop having happened.
  // So the floor gates only whether `named_a_tool === 0` may be CITED. It must
  // never suppress a refutation.
  let verdict;
  if (!deep) {
    verdict = "no-deep";
  } else if (deep.named_a_tool > 0) {
    verdict = "partly-refuted";
  } else {
    // Deliberately NOT "routing-inflated". `mode` cannot establish that.
    verdict = "cannot-attribute-lane";
  }

  return {
    deepTurns,
    deepShare,
    observedForDeep,
    chosenIsInformative,
    canAttributeLane: LANE_ATTRIBUTION_AVAILABLE,
    verdict,
  };
}

/**
 * How much of a population survives an INNER JOIN, and may the result be
 * trusted as describing the whole?
 *
 * An INNER JOIN drops non-matching rows SILENTLY — the loss never appears in
 * the grouped output, so a split computed over 40% of the data looks exactly
 * like one computed over all of it. This makes the drop explicit.
 *
 * @param {{ total: number, joined: number, floor?: number }} args
 * @returns {{ dropped: number, pct: number, usable: boolean }}
 */
export function assessJoinCoverage(args) {
  const { total, joined } = args;
  const floor = args.floor ?? JOIN_COVERAGE_FLOOR;
  // No population means no coverage — not 100%. An empty join reporting
  // "100% usable" is a measured zero dressed as a clean bill of health.
  if (total <= 0) return { dropped: 0, pct: 0, usable: false };
  return {
    dropped: total - joined,
    pct: (joined / total) * 100,
    usable: joined / total >= floor,
  };
}
