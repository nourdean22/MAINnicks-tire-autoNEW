import type { StrategicFramework } from "../types";

/**
 * Mechanical Intelligence (Greene, Mastery Book V) — the Wright brothers
 * crashed gliders while Langley theorized on a larger budget. Knowledge
 * of a system comes from handling it, not from its diagram.
 */
export const mechanicalIntelligence: StrategicFramework = {
  id: "mechanical-intelligence",
  name: "Mechanical Intelligence (Greene · Mastery)",
  oneLiner: "Understand the thing by handling it. Paper knowledge fails exactly where reality diverges from the spec.",
  triggers: [
    /\b(on\s+paper|in\s+theory|theoretically)\b/i,
    /\b(haven'?t|have\s+not|not)\s+(tried|tested|used)\s+it\b/i,
    /\b(spec|design|architect|plan)\s+(it\s+)?(out\s+)?(first|before)\b/i,
    /\b(before\s+(i|we)\s+build|prototype\s+first)\b/i,
    /\b(over.?(thinking|planning|engineering))\s+(the\s+)?(design|build|architecture)?\b/i,
    /\b(hands.?on|dogfood(ing)?)\b/i,
  ],
  weight: 0.9,
  lens: `Apply Mechanical Intelligence. Push toward physical contact with
the system before further reasoning about it — the crude working version
this session, not a better diagram. Ask what has actually been observed
versus inferred: a dashboard reports what was measured, the floor reports
what happened, and the gap between them is where the decision goes wrong.
Recommend using the thing for a real interval before specifying its next
version, and breaking it deliberately to find where it fails rather than
where failure was assumed. Treat planning time exceeding hands-on time as
the signal to stop planning.`,
};
