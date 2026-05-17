/**
 * Wisdom Topic Tagger · v10.0.394
 *
 * Per direction B1 from the enrichment memo · classify each wisdom into
 * one or more domain topics so recall can bias toward the right domain
 * when query intent is clear ("how should I price this" → MONEY ·
 * "team is dragging" → PEOPLE).
 *
 * The brain has 991 wisdoms with NO topic structure today. They live as
 * a flat pool · CoALA (v10.0.367) classified them by KIND (semantic /
 * episodic / procedural) but there's no DOMAIN axis. Adding one means
 * recall can match domain to query intent · cross-cutting with the
 * existing kind classification.
 *
 * APPROACH · pure heuristic (keyword + pattern match) · no AI call ·
 * deterministic + fast + free. Each wisdom can have 0-3 topics.
 *
 * 10 DOMAIN TOPICS:
 *   · money       · pricing, capital, revenue, cost, margin, savings, ROI
 *   · people      · team, hire, manage, conflict, customer, leader
 *   · strategy    · plan, decide, position, long-term, moat
 *   · execution   · ship, deliver, focus, momentum, velocity
 *   · ops         · process, workflow, system, repeat, ritual
 *   · brand       · voice, identity, perception, signal, reputation
 *   · self        · identity, mindset, belief, ego, fear, growth
 *   · body        · sleep, energy, recovery, exercise, diet, fatigue
 *   · time        · schedule, calendar, priority, urgency, decision-time
 *   · power       · influence, leverage, authority, control, dynamics
 *
 * Returns the topic list as metadata so /brain/wisdom dashboard can
 * filter by domain and recall can boost on domain match.
 */

export type WisdomTopic =
  | "money"
  | "people"
  | "strategy"
  | "execution"
  | "ops"
  | "brand"
  | "self"
  | "body"
  | "time"
  | "power";

const TOPIC_KEYWORDS: Record<WisdomTopic, string[]> = {
  money: [
    "price", "pricing", "cost", "margin", "revenue", "profit", "capital",
    "investment", "savings", "ROI", "compound", "roi", "buy", "sell",
    "wealth", "money", "dollar", "$", "expense", "income", "value",
    "ticket", "spend", "deal",
  ],
  people: [
    "team", "hire", "fire", "manage", "leader", "lead", "report", "trust",
    "conflict", "customer", "person", "people", "trust", "relationship",
    "communicate", "delegate", "feedback", "review", "performance",
  ],
  strategy: [
    "strategy", "strategic", "plan", "decide", "decision", "position",
    "long-term", "long term", "moat", "competitive", "advantage",
    "category", "market", "future", "vision", "framework",
  ],
  execution: [
    "ship", "deliver", "execute", "execution", "focus", "momentum",
    "velocity", "iterate", "iterati", "MVP", "fast", "speed",
    "experiment", "build", "launch", "release",
  ],
  ops: [
    "process", "workflow", "system", "ritual", "repeat", "checklist",
    "SOP", "automate", "automation", "batch", "throughput", "bottleneck",
    "operation", "ops", "routine",
  ],
  brand: [
    "brand", "voice", "identity", "perception", "signal", "reputation",
    "story", "narrative", "messaging", "position", "perception", "image",
    "trust", "tone", "consistent",
  ],
  self: [
    "identity", "mindset", "belief", "ego", "fear", "growth", "self",
    "character", "habit", "discipline", "practice", "introspection",
    "shadow", "doubt", "confidence",
  ],
  body: [
    "sleep", "energy", "recovery", "exercise", "workout", "diet", "fatigue",
    "rest", "movement", "physical", "body", "health", "stamina",
    "circadian", "morning", "evening",
  ],
  time: [
    "schedule", "calendar", "priority", "urgent", "urgency", "now",
    "today", "tomorrow", "deadline", "decision-time", "time-box",
    "window", "morning", "afternoon", "evening",
  ],
  power: [
    "power", "influence", "leverage", "authority", "control", "dynamics",
    "negotiation", "persuasion", "intimidation", "respect", "status",
    "boundaries", "frame", "social",
  ],
};

/**
 * Classify a wisdom string into 0-3 most-relevant topics.
 *
 * Heuristic scoring · count keyword matches per topic · top 3 over a
 * minimum match threshold get assigned.
 */
export function tagWisdomTopics(content: string): WisdomTopic[] {
  const lower = content.toLowerCase();
  const scores: Array<{ topic: WisdomTopic; score: number }> = [];

  for (const topic of Object.keys(TOPIC_KEYWORDS) as WisdomTopic[]) {
    const keywords = TOPIC_KEYWORDS[topic];
    let score = 0;
    for (const kw of keywords) {
      // Word-boundary match · prevents 'price' matching 'apprise' etc.
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(lower)) score++;
    }
    if (score >= 1) scores.push({ topic, score });
  }

  // Sort by score desc, take top 3
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, 3).map((s) => s.topic);
}

/**
 * Map any chat query to most-likely topics so recall can boost
 * matching-domain wisdoms.
 */
export function classifyQueryTopics(query: string): WisdomTopic[] {
  return tagWisdomTopics(query);
}

const TOPIC_MATCH_BOOST = 1.15;

/**
 * Boost factor when memory's topic intersects with query's topics.
 * Conservative · won't override semantic match, just breaks ties.
 */
export function topicBoost(memoryTopics: WisdomTopic[], queryTopics: WisdomTopic[]): number {
  if (memoryTopics.length === 0 || queryTopics.length === 0) return 1.0;
  const memorySet = new Set(memoryTopics);
  const overlap = queryTopics.some((t) => memorySet.has(t));
  return overlap ? TOPIC_MATCH_BOOST : 1.0;
}

const TOPIC_LABEL: Record<WisdomTopic, string> = {
  money: "Money",
  people: "People",
  strategy: "Strategy",
  execution: "Execution",
  ops: "Ops",
  brand: "Brand",
  self: "Self",
  body: "Body",
  time: "Time",
  power: "Power",
};

export function topicLabel(t: WisdomTopic): string {
  return TOPIC_LABEL[t];
}
