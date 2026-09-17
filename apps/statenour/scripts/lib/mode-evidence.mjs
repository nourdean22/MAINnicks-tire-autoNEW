/**
 * Pure verdict logic for `scripts/probe-surfaced-by-mode.mjs`.
 *
 * Extracted so the part that can LIE is testable without a database. The probe
 * itself does the I/O; everything that decides what the numbers are allowed to
 * mean lives here.
 *
 * The lie this guards against: `tool.chosen` only began writing on 2026-09-17
 * (#2390), while `tool.surfaced` has written for weeks. A LEFT JOIN from
 * surfaced -> chosen therefore reports every older turn as "never named a
 * tool", which reads as strong evidence that the deep path is tool-blind when
 * it is really just the lane's age. `chosenIsInformative` is the floor that
 * stops the `named>=1` column from being read as evidence before enough chosen
 * rows exist to carry it.
 */

/** Below this many `tool.chosen` rows, the `named>=1` column means nothing. */
export const CHOSEN_COVERAGE_FLOOR = 30;

/**
 * @param {{ rows: Array<{mode: string, turns: number, with_chosen_row: number, named_a_tool: number}>,
 *           total: number, floor?: number }} args
 * @returns {{ deepTurns: number, deepShare: number|null, chosenRows: number,
 *             chosenIsInformative: boolean, verdict: "no-deep"|"routing-inflated"|"partly-refuted" }}
 */
export function classifyModeEvidence(args) {
  const { rows, total } = args;
  const floor = args.floor ?? CHOSEN_COVERAGE_FLOOR;

  const deep = rows.find((r) => r.mode === "deep");
  const deepTurns = deep ? deep.turns : 0;
  const chosenRows = rows.reduce((n, r) => n + r.with_chosen_row, 0);
  const chosenIsInformative = chosenRows >= floor;

  // Share is null rather than 0 when there is nothing to divide by — a 0.0%
  // printed off an empty table is exactly the measured zero this file exists
  // to prevent.
  const deepShare = total > 0 ? (deepTurns / total) * 100 : null;

  // The floor is ASYMMETRIC on purpose, because the two claims are not the
  // same kind of claim:
  //
  //   "deep NEVER names a tool"  — absence of evidence. Needs coverage, or a
  //                                lane that is simply too young reads as proof.
  //   "deep CAN name a tool"     — evidence of presence. ONE counterexample
  //                                settles it; a coverage floor cannot make a
  //                                real observation stop having happened.
  //
  // So `chosenIsInformative` gates only whether `named_a_tool === 0` may be
  // CITED as support. It must never suppress a refutation — gating both would
  // hide the one observation capable of disproving the hypothesis.
  let verdict;
  if (!deep) {
    verdict = "no-deep";
  } else if (deep.named_a_tool > 0) {
    verdict = "partly-refuted";
  } else {
    verdict = "routing-inflated";
  }

  return { deepTurns, deepShare, chosenRows, chosenIsInformative, verdict };
}
