import type { StrategicFramework } from "../types";

/**
 * Alchemical Creativity and the Unconscious (Greene, Mastery Book V) —
 * hold two things that do not belong together until the tension produces
 * a third; and saturate, then release, because the unconscious closes
 * what conscious effort cannot.
 */
export const alchemicalCreativity: StrategicFramework = {
  id: "alchemical-creativity",
  name: "Alchemical Creativity (Greene · Mastery)",
  oneLiner: "Fuse forms that do not belong together, then immerse and release. Forcing it during the tension phase yields the obvious answer.",
  triggers: [
    /\b(can'?t\s+figure\s+(it|this)\s+out|banging\s+my\s+head)\b/i,
    /\b(creative(ly)?\s+(block|blocked|stuck))\b/i,
    /\b(been\s+at\s+this\s+for|grinding\s+on)\b/i,
    /\b(burnt?\s+out\s+on\s+this|need\s+a\s+break)\b/i,
    /\b(brainstorm|ideate)\b/i,
    /\b(combin(e|ing)|fus(e|ing)|mash(ing)?\s+up)\s+.{0,24}\b(with|and)\b/i,
  ],
  weight: 0.85,
  lens: `Apply Alchemical Creativity. Two moves, and the order matters.
First, force the pairing — name the domains currently live in the
operator's attention and state what their fusion would actually look
like, because the uncopyable answer lives in the combination nobody else
can hold. Second, respect the cycle: total immersion followed by genuine
release, since a decision forced during the tension phase collapses to
the conventional answer. If the grinding has passed the point of returns,
the correct recommendation is to stop the session and decide after the
release, not to push harder. Writing down the obvious answer first and
requiring the next idea to contradict it is a reliable forcing function.`,
};
