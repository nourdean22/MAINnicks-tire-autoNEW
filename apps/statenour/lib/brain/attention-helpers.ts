/**
 * Pure-function helpers extracted from lib/brain/attention-tracker.ts
 * so they can be unit-tested without mocking Prisma.
 *
 * The full `analyzeAttentionPatterns()` pipeline is DB-dominated and
 * hard to isolate, but these primitives carry the math + classification
 * logic that's most likely to regress silently.
 */

/**
 * Keyword map used to classify chat messages into domains. Keep in
 * sync with the DOMAIN_KEYWORDS const in attention-tracker.ts (kept
 * separate so the tracker file stays single-concern).
 */
export const ATTENTION_DOMAIN_KEYWORDS: Readonly<Record<string, string[]>> = {
  revenue: ["revenue", "money", "income", "sales", "invoice", "payment", "profit", "cash", "$"],
  leads: ["lead", "customer", "callback", "follow-up", "followup", "contact", "phone", "call"],
  body: ["workout", "gym", "boxing", "weight", "exercise", "fitness", "health", "sleep"],
  relationship: ["dania", "wife", "marriage", "family", "date", "together"],
  system: ["code", "deploy", "build", "feature", "bug", "api", "database", "server"],
  strategy: ["plan", "goal", "mission", "target", "priority", "strategy", "roadmap"],
  operations: ["shop", "tech", "bay", "staff", "schedule", "inventory", "parts"],
  growth: ["marketing", "seo", "ads", "review", "reputation", "competitor", "expand"],
  mental: ["focus", "energy", "mood", "adhd", "drift", "discipline", "adderall"],
  financial: ["budget", "expense", "debt", "savings", "tax", "accounting"],
};

/**
 * Classify a chat message into domains by counting keyword hits per
 * domain. Empty map = no recognized domain.
 */
export function classifyMessageDomain(
  text: string,
  keywordMap: Readonly<Record<string, string[]>> = ATTENTION_DOMAIN_KEYWORDS,
): Map<string, number> {
  const out = new Map<string, number>();
  const lower = text.toLowerCase();
  for (const [domain, keywords] of Object.entries(keywordMap)) {
    const hits = keywords.filter((kw) => lower.includes(kw)).length;
    if (hits > 0) out.set(domain, hits);
  }
  return out;
}

/**
 * Focus score: how aligned is attention with priorities?
 * 0-100. Returns 50 (neutral) when there are no mentions at all —
 * zero-signal should not be interpreted as zero-focus.
 */
export function computeFocusScore(
  goalMentions: number,
  totalMentions: number,
): number {
  if (totalMentions <= 0) return 50;
  const ratio = goalMentions / totalMentions;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/**
 * Action ratio: action+question turns / total considered. Caller
 * decides what counts as an action — this helper just normalizes.
 */
export function computeActionRatio(
  actionCount: number,
  questionCount: number,
): number {
  const total = actionCount + questionCount;
  if (total <= 0) return 0;
  return Math.round((actionCount / total) * 100) / 100;
}

/**
 * Attention velocity: trend signal in [-100, 100]. Positive = focus
 * improving, negative = degrading. Compares two windows.
 */
export function computeAttentionVelocity(
  firstHalfScore: number,
  secondHalfScore: number,
): number {
  return Math.max(-100, Math.min(100, Math.round(secondHalfScore - firstHalfScore)));
}

/**
 * Bucket a Date into { morning, afternoon, evening } based on local
 * hour. Used by the time-of-day pattern analyzer.
 */
export type TimeBucket = "morning" | "afternoon" | "evening";

export function timeOfDayBucket(d: Date): TimeBucket {
  const h = d.getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

/**
 * CAL NEWPORT DEEP-WORK DETECTOR (Deep Work, 2016)
 *
 * "Deep work is professional activity performed in a state of
 *  distraction-free concentration that pushes your cognitive
 *  capabilities to their limit."
 *
 * Quality of attention > quantity. A message of 4 words on a domain
 * is shallow. A 200-word multi-clause analysis is deep. Track the
 * RATIO of deep:shallow attention per domain.
 *
 * Threshold heuristics:
 *   shallow: ≤ 30 chars OR ≤ 5 words OR no question/clause structure
 *   deep:    ≥ 80 chars AND ≥ 12 words AND has clause markers
 *   medium:  everything in between
 */
export type AttentionDepth = "shallow" | "medium" | "deep";

export function classifyAttentionDepth(message: string): AttentionDepth {
  const text = message.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const hasClauseStructure = /[,;:]|because|since|so that|whereas|although|however/i.test(text);
  const hasQuestion = /\?|how|why|what if|should i/i.test(text);

  if (text.length <= 30 || wordCount <= 5) return "shallow";
  if (text.length >= 80 && wordCount >= 12 && (hasClauseStructure || hasQuestion)) {
    return "deep";
  }
  return "medium";
}

/**
 * Compute the deep:shallow ratio for a stream of messages on a
 * domain. Healthy = ≥ 0.4 (40% deep). Below 0.15 = "thinking ABOUT
 * but not thinking THROUGH" — a soft form of attention.
 */
export function deepWorkRatio(messages: string[]): {
  deep: number;
  medium: number;
  shallow: number;
  ratio: number;
} {
  const counts = { deep: 0, medium: 0, shallow: 0 };
  for (const m of messages) counts[classifyAttentionDepth(m)]++;
  const total = counts.deep + counts.medium + counts.shallow || 1;
  return { ...counts, ratio: counts.deep / total };
}

/**
 * EISENHOWER MATRIX Q2 GAP (Eisenhower, popularized by Covey 1989)
 *
 * Q1: urgent + important       — handled out of necessity
 * Q2: NOT urgent + important   — the kingdom is built here
 * Q3: urgent + NOT important   — interruption
 * Q4: NOT urgent + NOT important — distraction
 *
 * Strategic decay starts when Q2 gets squeezed by Q1+Q3. The most
 * dangerous attention pattern: zero Q2 minutes for weeks while
 * "everything is fine" because nothing in Q1 is on fire.
 */
export type EisenhowerQuadrant = "Q1" | "Q2" | "Q3" | "Q4";

interface EisenhowerInput {
  topicName: string;
  importanceScore: number; // 0-1
  urgencyScore: number;    // 0-1
  attentionMinutes: number;
}

export function classifyEisenhower(
  importance: number,
  urgency: number,
): EisenhowerQuadrant {
  const i = importance >= 0.5;
  const u = urgency >= 0.5;
  if (i && u) return "Q1";
  if (i && !u) return "Q2";
  if (!i && u) return "Q3";
  return "Q4";
}

/**
 * Compute Q2 deficit — what fraction of important-but-not-urgent
 * topics got attention this period. Below 0.2 = strategic decay.
 */
export function eisenhowerQ2Deficit(topics: EisenhowerInput[]): {
  q2Topics: number;
  q2WithAttention: number;
  q2DeficitPct: number;
  starvedTopics: string[];
} {
  const q2Topics = topics.filter(
    (t) => classifyEisenhower(t.importanceScore, t.urgencyScore) === "Q2",
  );
  const q2WithAttention = q2Topics.filter((t) => t.attentionMinutes > 0).length;
  const starvedTopics = q2Topics
    .filter((t) => t.attentionMinutes <= 0)
    .map((t) => t.topicName);
  const total = q2Topics.length || 1;
  return {
    q2Topics: q2Topics.length,
    q2WithAttention,
    q2DeficitPct: Math.round((1 - q2WithAttention / total) * 100),
    starvedTopics,
  };
}

/**
 * BOYD OODA-STYLE ATTENTION LATENCY (John Boyd)
 *
 * "He who can handle the quickest rate of change survives."
 *
 * When something changes in a domain (revenue drops, person goes
 * silent, score declines), how long until that domain re-enters
 * Nour's attention stream? Slow latency = blindness to that
 * domain.
 *
 * Returns days between an event timestamp and the next mention of
 * the same domain in chat/journal. Capped at 30 days.
 */
export function attentionLatencyDays(
  domainEventAt: Date,
  domainMentions: Array<{ at: Date }>,
): number | null {
  const eventTime = domainEventAt.getTime();
  const subsequent = domainMentions.filter((m) => m.at.getTime() > eventTime);
  if (subsequent.length === 0) return null; // no mention yet
  const earliest = Math.min(...subsequent.map((m) => m.at.getTime()));
  const ms = earliest - eventTime;
  return Math.min(30, Math.floor(ms / 86400_000));
}
