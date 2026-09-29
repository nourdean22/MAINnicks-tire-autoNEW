import type {
  ChoiceQuestion,
  DecisionEntry,
  NoulQuestion,
  ScoreQuestion,
} from "./types";

export function noul(
  instructions: DecisionEntry,
  criteria?: NoulQuestion["criteria"],
): NoulQuestion {
  return {
    type: "noul",
    instructions,
    ...(criteria === undefined ? {} : { criteria }),
  };
}

export function choice<const T extends Record<string, DecisionEntry>>(
  instructions: DecisionEntry,
  criteria: T,
): ChoiceQuestion<T> {
  if (Object.keys(criteria).length < 2) {
    throw new Error("Decision choice requires at least two criteria");
  }
  return { type: "choice", instructions, criteria };
}

export function score<
  const T extends readonly [DecisionEntry, DecisionEntry, ...DecisionEntry[]],
>(instructions: DecisionEntry, criteria: T): ScoreQuestion<T> {
  if (criteria.length > 10) {
    throw new Error("Decision score supports at most ten rubric levels");
  }
  return { type: "score", instructions, criteria };
}
