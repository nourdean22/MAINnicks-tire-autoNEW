/**
 * v10.0.356 · Wisdom quality gate.
 *
 * Every write to category="wisdom" runs through this. Rejected wisdom
 * is NOT silently dropped · it's redirected to category="wisdom_candidate"
 * with a `gateReject` reason in metadata. That gives the operator a
 * review queue (visible on /brain/wisdom) without losing data.
 *
 * The bar is deliberately strict · the wisdom layer is high-stakes
 * (recall reserves 3 slots per chat turn) so vague boilerplate has
 * outsize cost. Better to err on the side of "candidate, review later"
 * than to flood the recall pool with shapeless meta-summaries.
 *
 * Three failure modes captured:
 *   1. Length · too short (no room for a principle) or too long
 *      (probably an extended chat snippet, not a principle)
 *   2. Vague meta-pattern · "Nick frequently provides advice…"
 *      pattern that's a SUMMARY of behavior, not a PRINCIPLE
 *   3. No actionable shape · principle should imply WHEN something
 *      happens or WHAT to do · pure descriptions get demoted
 */

const MIN_LEN = 60;     // Less = too short for a principle
const MAX_LEN = 800;    // More = probably a chat snippet, not a principle

/**
 * Vague meta-summary patterns. These start with subject ("Nick", "Nour",
 * "the user") followed by a frequency adverb (frequently, often, usually,
 * typically, generally, consistently, regularly) and a verb of generic
 * activity (provides, offers, focuses, mentions, discusses, talks).
 *
 * They describe behavior · they don't carry actionable wisdom. Common
 * output of low-rigor distillation passes that summarize chat instead
 * of synthesizing principle.
 */
const VAGUE_PATTERNS: RegExp[] = [
  /^(?:nick|nour|the user)\s+(?:frequently|often|usually|typically|generally|consistently|regularly|always|normally)\s+(?:provides?|offers?|gives?|shares?|focuses?|mentions?|discusses?|talks?|asks?|tries?|wants?|needs?|prefers?)\b/i,
  /^(?:nick|nour|the user)['']s?\s+(?:advice|approach|behavior|pattern|style|tendency|focus)\s+(?:reflects?|encompasses?|involves?|includes?|covers?|spans?|relates?\s+to)\b/i,
  /^the\s+(?:advice|conversation|message|response|interaction|exchange)\s+(?:reflects?|focuses?|covers?|discusses?|provides?|offers?)\b/i,
];

/**
 * Action-shape markers. We want at least one of these in the wisdom
 * text · they're proxies for "this carries actionable signal":
 *   · Conditional markers · when/if/before/after/unless/until
 *   · Imperative verbs · do/don't/avoid/start/stop/keep/remove/cancel
 *   · Principle markers · principle/rule/law/heuristic
 *   · Threshold markers · over/under/below/above/exceeds/falls
 *   · Quantitative · digits + unit (3x, $50, 22%, 8 hours)
 */
const ACTION_MARKERS: RegExp[] = [
  /\b(?:when|if|before|after|unless|until|once|whenever|while)\b/i,
  /\b(?:do(?:n['']t)?|avoid|start|stop|keep|remove|cancel|cut|add|always|never)\b/i,
  /\b(?:principle|rule|law|heuristic|axiom|maxim|tenet)\b/i,
  /\b(?:over|under|below|above|exceeds?|falls?|drops?|rises?|spikes?|hits?)\b/i,
  /\d+(?:\.\d+)?\s*(?:x|%|\$|hr|hrs|hour|hours|min|mins|day|days|week|weeks|month|months|year|years)?/i,
];

export interface WisdomGateResult {
  pass: boolean;
  reason?: "too_short" | "too_long" | "vague_meta" | "no_action_shape";
  detail?: string;
}

/**
 * Run the gate. Returns { pass: true } if the wisdom is principle-shaped,
 * else { pass: false, reason, detail } describing why.
 */
export function gateWisdom(content: string): WisdomGateResult {
  const trimmed = content.trim();

  if (trimmed.length < MIN_LEN) {
    return {
      pass: false,
      reason: "too_short",
      detail: `length ${trimmed.length} < ${MIN_LEN} chars`,
    };
  }
  if (trimmed.length > MAX_LEN) {
    return {
      pass: false,
      reason: "too_long",
      detail: `length ${trimmed.length} > ${MAX_LEN} chars`,
    };
  }

  // Strip lead tags like [PROVEN PATTERN], [PROMOTED TO WISDOM] for matching ·
  // we want to see the underlying content shape, not the wrapper.
  const stripped = trimmed.replace(/^\[[^\]]+\]\s*/g, "");

  for (const re of VAGUE_PATTERNS) {
    if (re.test(stripped)) {
      return {
        pass: false,
        reason: "vague_meta",
        detail: `matches vague-summary pattern: ${re.source.slice(0, 60)}…`,
      };
    }
  }

  const hasActionShape = ACTION_MARKERS.some((re) => re.test(stripped));
  if (!hasActionShape) {
    return {
      pass: false,
      reason: "no_action_shape",
      detail: "no conditional / imperative / threshold / quantitative marker found",
    };
  }

  return { pass: true };
}
