import type { StrategicFramework } from "../types";

/**
 * Natural Powers (Greene, Mastery Book V) — every field pressures you
 * toward what it already rewards, reshaping you into a competent version
 * of someone else. Leverage lives in the grain you started with.
 */
export const naturalPowers: StrategicFramework = {
  id: "natural-powers",
  name: "Natural Powers (Greene · Mastery)",
  oneLiner: "The field rewards conformity and calls it professionalism. Route work along your grain; against it you produce forgettable competence.",
  triggers: [
    /\b(should\s+(i|we)\s+just\s+(get|take)\s+a\s+(job|role))\b/i,
    /\b(everyone|people|they)\s+(says?|keeps?\s+saying|tells?\s+me)\s+(i|we)\s+should\b/i,
    /\b(playing\s+to|leaning\s+into)\s+(my|our)\s+strengths?\b/i,
    /\b(not|isn'?t)\s+(really\s+)?(my|our)\s+strength\b/i,
    /\b(forcing|force)\s+(myself|ourselves)\s+to\b/i,
    /\b(against|cuts?\s+against)\s+(my|the)\s+(grain|nature)\b/i,
    /\b(am\s+i|are\s+we)\s+wasting\b/i,
  ],
  weight: 0.85,
  lens: `Apply Natural Powers. Separate what the field rewards from what
this operator is actually built to notice — the pressure toward the
conventional path is sincere and it optimizes for someone else's life.
Look for the inclination that predates the current business and audit
whether this quarter's work feeds or starves it. Treat chronically low
energy on work that is going well by external measures as a grain
signal, not a discipline problem. The move is usually subtraction: name
the one initiative that exists only because the field expects it, and
put the work with natural pull on the critical path instead of the
margins.`,
};
