/**
 * BDI (Belief · Desire · Intention) typing for brain memories · v10.0.360
 *
 * Soft overlay on the existing BrainMemory schema · we don't add columns
 * or migrate data; instead we classify each memory at query time based
 * on category + content. This keeps the schema lean while exposing a
 * structured cognitive layer to the UI and to recall.
 *
 * The BDI architecture:
 *   · Belief    — what Nick believes is true about the world
 *                 (wisdom, patterns, observations, confirmed predictions)
 *   · Desire    — what Nick wishes to bring about
 *                 (active missions, commitments, open loops)
 *   · Intention — what Nick has committed to achieving
 *                 (READY/DOING tasks with concrete next-actions)
 *   · Observation — raw perception, not yet a stable belief
 *                 (recent insights, conversation snippets, anomalies)
 *
 * Per /bdi-mental-states skill · enables traceable reasoning chains and
 * explainability for "why did Nick say that?". Without typing every
 * recalled memory looks the same; with typing the answer becomes
 * "Nick said this because Beliefs A+B led to Desire C which became
 * Intention D".
 */

export type BdiType = "belief" | "desire" | "intention" | "observation";

interface CategorySig {
  category: string;
  bdi: BdiType;
}

const CATEGORY_TO_BDI: Record<string, BdiType> = {
  // ── Beliefs · stable cognitive state ──
  wisdom: "belief",
  wisdom_contradiction: "belief", // a belief about beliefs
  pattern: "belief",
  insight: "belief",
  counter_intuitive: "belief",
  hidden_correlation: "belief",
  preference: "belief",
  business_alert: "belief",
  prediction_lesson: "belief",

  // ── Desires · what Nick wishes to bring about ──
  // (no schema-level desires yet · derived from Mission status at runtime)

  // ── Intentions · committed actions ──
  // (derived from Task table at runtime · category="task" doesn't appear in BrainMemory)

  // ── Observations · raw perception, not yet stable ──
  anomaly: "observation",
  device_behavior: "observation",
  conversation_summary: "observation",
  nick_advice: "observation", // raw advice, may stabilize into belief later
  glitch_capture: "observation",
  daily_score: "observation",
  routine: "observation",

  // ── Default · treat unknowns as observations · safer than belief ──
};

/**
 * Classify a brain memory by its BDI role.
 */
export function bdiTypeOf(memory: {
  category: string;
  content?: string;
  confidence?: number;
}): BdiType {
  const fromCategory = CATEGORY_TO_BDI[memory.category];
  if (fromCategory) {
    // Low-confidence "beliefs" are really observations until they
    // earn the right to be beliefs · per Popper's falsifiability.
    if (fromCategory === "belief" && (memory.confidence ?? 0) < 0.6) {
      return "observation";
    }
    return fromCategory;
  }

  // Fallback · content sniffing for known shapes
  if (memory.content) {
    const c = memory.content.toLowerCase();
    if (c.includes("when") && (c.includes("then") || c.includes("do "))) {
      return "belief"; // WHEN/THEN form is principle-shaped
    }
    if (c.match(/\b(want|wish|need|aim|goal|plan to)\b/)) {
      return "desire";
    }
    if (c.match(/\b(will|going to|committed to|by .* (today|tomorrow|next))\b/i)) {
      return "intention";
    }
  }

  return "observation";
}

const BDI_TONE_MAP: Record<BdiType, { label: string; cssTone: string }> = {
  belief: { label: "Belief", cssTone: "text-amber-300" },
  desire: { label: "Desire", cssTone: "text-violet-300" },
  intention: { label: "Intention", cssTone: "text-emerald-300" },
  observation: { label: "Observation", cssTone: "text-sky-300" },
};

export function bdiLabel(t: BdiType): string {
  return BDI_TONE_MAP[t].label;
}

export function bdiTone(t: BdiType): string {
  return BDI_TONE_MAP[t].cssTone;
}

/**
 * Group a list of memories into the BDI quadrants. Used by the
 * provenance UI to show "why Nick said this" structurally.
 */
export function groupByBdi<T extends { category: string; content?: string; confidence?: number }>(
  items: T[],
): Record<BdiType, T[]> {
  const out: Record<BdiType, T[]> = {
    belief: [],
    desire: [],
    intention: [],
    observation: [],
  };
  for (const item of items) {
    const t = bdiTypeOf(item);
    out[t].push(item);
  }
  return out;
}

/**
 * Render a single-line cognitive chain summary from grouped memories.
 * Example: "3 beliefs · 1 intention · 2 observations"
 */
export function bdiChainSummary<T extends { category: string; content?: string; confidence?: number }>(
  items: T[],
): string {
  const grouped = groupByBdi(items);
  const parts: string[] = [];
  if (grouped.belief.length) parts.push(`${grouped.belief.length} belief${grouped.belief.length === 1 ? "" : "s"}`);
  if (grouped.desire.length) parts.push(`${grouped.desire.length} desire${grouped.desire.length === 1 ? "" : "s"}`);
  if (grouped.intention.length) parts.push(`${grouped.intention.length} intention${grouped.intention.length === 1 ? "" : "s"}`);
  if (grouped.observation.length) parts.push(`${grouped.observation.length} observation${grouped.observation.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

const _categories: CategorySig[] = Object.entries(CATEGORY_TO_BDI).map(
  ([category, bdi]) => ({ category, bdi }),
);
export const BDI_CATEGORY_REGISTRY = _categories;
