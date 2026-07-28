import type { StrategicFramework } from "../types";

/**
 * Dimensional Thinking (Greene, Mastery Book V) — Leonardo studied an
 * object from every side, in motion, across time. The specialist sees one
 * plane and mistakes it for the whole.
 */
export const dimensionalThinking: StrategicFramework = {
  id: "dimensional-thinking",
  name: "Dimensional Thinking (Greene · Mastery)",
  oneLiner: "The block is a fixed vantage point, not missing intelligence. Rotate the problem before working harder inside it.",
  triggers: [
    /\b(another|different)\s+(way\s+to\s+look|angle|perspective|lens)\b/i,
    /\b(re.?frame|zoom\s+out|step\s+back)\b/i,
    /\b(what\s+am\s+i\s+missing|blind\s+spot|tunnel\s+vision)\b/i,
    /\b(only\s+see(ing)?|one\s+angle)\b/i,
    /\b(stuck\s+on\s+(this|the)\s+(problem|one))\b/i,
    /\b(from\s+the\s+(customer|client|tech|team)'?s?\s+(side|view|perspective))\b/i,
  ],
  weight: 0.85,
  lens: `Apply Dimensional Thinking. Assume the obstacle is the vantage
point rather than the effort, and rotate before pushing. Restate the
problem from at least three positions the operator does not occupy — the
customer's, the person executing it, and the ledger's — then add a time
axis by asking what the decision looks like in five days and in five
years. Where a vantage point is genuinely unavailable, name who holds it
and what to ask them. Changing the medium counts as rotation: said aloud
or drawn, a constraint that felt structural often turns out to be
imaginary.`,
};
