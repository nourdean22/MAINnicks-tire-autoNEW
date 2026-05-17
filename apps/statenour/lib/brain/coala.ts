/**
 * CoALA cognitive architecture · v10.0.367
 *
 * Per /memory-systems and /agent-memory-systems skills · Cognitive
 * Architectures for Language Agents (Sumers et al, 2024) split memory
 * into three kinds, each with different retrieval characteristics:
 *
 *   · SEMANTIC   · facts and concepts (what IS true)
 *                  e.g. "tire margins are 35-40%", "Cleveland tax rate 8%"
 *   · EPISODIC   · events Nick experienced (what HAPPENED)
 *                  e.g. "yesterday Nour asked about pricing", chat snippets,
 *                  past replies, conversation summaries
 *   · PROCEDURAL · how-to knowledge (HOW to act)
 *                  e.g. "when X, do Y because Z" wisdom principles,
 *                  workflows, recipes, decision rules
 *
 * Why this matters for retrieval:
 *   "what is the tire margin?"  → bias toward SEMANTIC
 *   "what did Nour say last week?" → bias toward EPISODIC
 *   "how should I respond to a complaint?" → bias toward PROCEDURAL
 *
 * The brain has flat category strings today. We classify at QUERY TIME
 * (no schema migration) by mapping category → kind, then apply a kind-
 * match boost on the hybrid score during recall.
 */

export type CoalaKind = "semantic" | "episodic" | "procedural" | "unspecified";

const CATEGORY_TO_KIND: Record<string, CoalaKind> = {
  // ── PROCEDURAL · how-to · principles · workflows ──
  wisdom: "procedural",
  wisdom_candidate: "procedural",
  pattern: "procedural",
  routine: "procedural",
  prediction_lesson: "procedural",
  counter_intuitive: "procedural",
  hidden_correlation: "procedural",
  decision_manual: "procedural",
  belief: "procedural",
  // ── SEMANTIC · facts · concepts ──
  business_alert: "semantic",
  insight: "semantic",
  preference: "semantic",
  domain_knowledge: "semantic",
  contradiction: "semantic",
  wisdom_contradiction: "semantic",
  // ── EPISODIC · events · conversation snippets ──
  nick_advice: "episodic",
  conversation_summary: "episodic",
  glitch_capture: "episodic",
  daily_score: "episodic",
  device_behavior: "episodic",
  reply_judgment: "episodic",
  anomaly: "episodic",
};

export function coalaKindOf(memory: { category: string }): CoalaKind {
  return CATEGORY_TO_KIND[memory.category] ?? "unspecified";
}

/**
 * Classify a query to bias retrieval. Returns the most likely kind
 * the query is asking for, or null if no clear bias.
 *
 * Heuristic: lexical markers. "What did", "yesterday", "last week"
 * → episodic. "How do I", "how should I" → procedural. "What is",
 * "what's the", "how much" → semantic. Defaults to no bias.
 */
export function classifyQuery(query: string): CoalaKind | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  // EPISODIC markers · past events, time references
  if (/\b(what (did|happened)|yesterday|last (week|month|night)|earlier|recently|just (asked|said|told|talked))\b/.test(q)) {
    return "episodic";
  }
  if (/\b(remember (when|what)|recall|that (chat|convo|talk))\b/.test(q)) {
    return "episodic";
  }

  // PROCEDURAL markers · how-to questions
  if (/\b(how (do|should|can) (i|we)|what(?:'s| is) the (best|right) way|step by step|process for|workflow)\b/.test(q)) {
    return "procedural";
  }
  if (/\b(should i|what should|recommend|advice on|approach to)\b/.test(q)) {
    return "procedural";
  }

  // SEMANTIC markers · fact lookups
  if (/\b(what (is|are|was)|how much|how many|when (is|did|was)|who (is|was)|where (is|was)|what(?:'s| are) (the|my))\b/.test(q)) {
    return "semantic";
  }
  if (/\b(define|definition|meaning of|explain (what|the))\b/.test(q)) {
    return "semantic";
  }

  return null;
}

/**
 * Boost factor for memories matching the query's CoALA kind.
 * Conservative · 1.20x lift on match · doesn't override semantic match.
 */
const KIND_MATCH_BOOST = 1.20;

export function coalaKindBoost(memoryKind: CoalaKind, queryKind: CoalaKind | null): number {
  if (!queryKind) return 1.0;
  if (memoryKind === queryKind) return KIND_MATCH_BOOST;
  if (memoryKind === "unspecified") return 1.0; // don't penalize unclassified
  return 1.0;
}

const KIND_LABEL: Record<CoalaKind, string> = {
  semantic: "Semantic",
  episodic: "Episodic",
  procedural: "Procedural",
  unspecified: "Unclassified",
};

export function coalaLabel(k: CoalaKind): string {
  return KIND_LABEL[k];
}

/**
 * Group a list of memories by CoALA kind. Used by UI for transparent
 * memory architecture display.
 */
export function groupByCoalaKind<T extends { category: string }>(
  items: T[],
): Record<CoalaKind, T[]> {
  const out: Record<CoalaKind, T[]> = {
    semantic: [],
    episodic: [],
    procedural: [],
    unspecified: [],
  };
  for (const item of items) {
    out[coalaKindOf(item)].push(item);
  }
  return out;
}
