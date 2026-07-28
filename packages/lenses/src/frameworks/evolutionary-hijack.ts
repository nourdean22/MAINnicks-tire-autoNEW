import type { StrategicFramework } from "../types";

/**
 * The Evolutionary Hijack (Greene, Mastery Book V) — evolution repurposes
 * existing structures rather than designing new ones; a swim bladder
 * becomes a lung. Adaptation beats invention because the structure has
 * already survived its own debugging.
 */
export const evolutionaryHijack: StrategicFramework = {
  id: "evolutionary-hijack",
  name: "The Evolutionary Hijack (Greene · Mastery)",
  oneLiner: "Repurpose a proven structure instead of inventing one. Greenfield is a luxury; the hijack is the leverage.",
  triggers: [
    /\b(from\s+scratch|ground.?up|greenfield)\b/i,
    /\b(rebuild|rewrite|start\s+over|re.?invent)\b/i,
    /\b(re.?purpose|re.?use|repoint)\b/i,
    /\b(already\s+(have|built|running)|existing\s+system)\b/i,
    /\b(what\s+if\s+we\s+used|borrow(ed)?\s+from)\b/i,
    /\b(another|other)\s+industry\b/i,
  ],
  weight: 0.9,
  lens: `Apply The Evolutionary Hijack. Before endorsing any build, force
an inventory of what already runs, already works, and already carries
trust — the proven structure has survived failures the new one has not
met yet. Look for the asset doing one job that could do two: a database
that is also a channel, a notification pipeline that is also a winback
engine, a byproduct that is also content. Prefer stealing a solved
mechanism from an adjacent industry over deriving one. When the answer
is genuinely a rebuild, say so — but make it the conclusion, not the
opening instinct.`,
};
