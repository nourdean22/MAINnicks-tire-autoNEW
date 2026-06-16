/**
 * QUERY-SHAPE DETECTION
 *
 * Looks at the user message and classifies its SHAPE (not topic — topic
 * detection lives in system-prompt.ts). The shape drives two things:
 *
 *   1. maxOutputTokens — a yes/no question doesn't need 1200 tokens;
 *      a strategic plan needs more than the 500-token quick cap.
 *   2. Tool-first directive — factual queries that reference data Nick
 *      has tools for ("how much revenue this week") should force a tool
 *      call first so Nick doesn't hallucinate numbers.
 *
 * Everything here is a pure function — no I/O, no DB, just regex.
 * Called once at the start of the chat route.
 */

export type QueryShape =
  | "yes_no"       // decision / confirmation / binary
  | "explain"      // how does X work, what is X, tell me about X
  | "plan"         // strategy, roadmap, break-down, approach
  | "list"         // enumerate N options/items
  | "factual"      // specific data question (numbers, counts, records)
  | "casual"       // greeting / acknowledgement / vibes
  | "default";     // mixed / unclear

interface ShapeResult {
  shape: QueryShape;
  tokenBudget: number;         // suggested maxOutputTokens
  needsTool: boolean;          // force a tool-first call for factual queries
  factualHints: string[];      // which tool families the query touches
}

// ─── Patterns ───────────────────────────────────────────────
const YES_NO_PATTERN = /^(is|are|was|were|do|does|did|can|could|should|shall|will|would|have|has|had|am)\b[^?]{3,120}\??$/i;
const YES_NO_CHOICE = /\b(or|vs\.?|versus)\b.*\?$/i; // "A or B?" "this vs that?"

const EXPLAIN_PATTERN = /^(explain|tell me about|what is|what's|what are|how does|how do|how is|what does|walk me through|describe|define)\b/i;

const PLAN_PATTERN = /\b(plan|strategy|roadmap|approach|break.?down|break it down|steps to|game plan|outline|architecture|design)\b/i;

const LIST_PATTERN = /\b(list|give me (\d+|a few|some|several)|show me (\d+|all|every)|enumerate|top \d+|best \d+|which \d+)\b/i;

const CASUAL_PATTERN = /^(hi|hey+|yo+|sup|hello|thanks|ty|cool|nice|ok|okay|got it|k|kk|lol|haha+|morning|evening|good (morning|night|evening))\b/i;

// Factual data queries — each family maps to the tools Nick has
const FACTUAL_FAMILIES: Array<{ pattern: RegExp; family: string }> = [
  { pattern: /\b(revenue|money|income|\$|profit|cash|paid|earned|earnings|gross|net|margin)\b/i, family: "revenue" },
  { pattern: /\b(leads?|callbacks?|customers?|clients?|prospects?)\b/i, family: "leads" },
  { pattern: /\b(quotes?|estimates?|invoices?)\b/i, family: "quotes" },
  { pattern: /\b(tasks?|todos?|actions?|missions?)\b/i, family: "tasks" },
  { pattern: /\b(habits?|streaks?|workouts?|discipline)\b/i, family: "habits" },
  { pattern: /\b(scores?|today'?s? score|energy|focus|mood|journal)\b/i, family: "scores" },
  { pattern: /\b(commitments?|promises?|overdue)\b/i, family: "commitments" },
  { pattern: /\b(blind.?spots?|drift|alerts?)\b/i, family: "drift" },
  { pattern: /\b(memories|memory|what did|remember|brain dump)\b/i, family: "memory" },
  { pattern: /\b(pipeline|aging|stale|decline)\b/i, family: "pipeline" },
];

// Factual tells — these tokens signal "I want a specific answer from data"
// more strongly than the family matches above. "How many" + "leads" →
// very high confidence factual.
const FACTUAL_COUNTER = /^(how many|how much|what'?s the|how's the|what is the|count|show me the|list my|pull up)\b/i;

/**
 * Classify a user message. Never returns null — falls back to "default".
 */
export function detectQueryShape(message: string): ShapeResult {
  const text = (message || "").trim();
  const len = text.length;

  // Casual first — short greetings get the smallest budget
  if (CASUAL_PATTERN.test(text) && len < 40) {
    return { shape: "casual", tokenBudget: 300, needsTool: false, factualHints: [] };
  }

  // Factual data questions — strong match: tool-first
  const familyHits: string[] = [];
  for (const { pattern, family } of FACTUAL_FAMILIES) {
    if (pattern.test(text)) familyHits.push(family);
  }
  const isFactualCounter = FACTUAL_COUNTER.test(text);
  if (familyHits.length > 0 && (isFactualCounter || len < 140)) {
    return {
      shape: "factual",
      tokenBudget: 500,
      needsTool: true,
      factualHints: familyHits,
    };
  }

  // Yes / no questions — tight budget
  if (YES_NO_PATTERN.test(text) || YES_NO_CHOICE.test(text)) {
    return {
      shape: "yes_no",
      tokenBudget: 400,
      needsTool: familyHits.length > 0,
      factualHints: familyHits,
    };
  }

  // Plan / strategy — big budget
  if (PLAN_PATTERN.test(text)) {
    return {
      shape: "plan",
      tokenBudget: 1600,
      needsTool: familyHits.length > 0,
      factualHints: familyHits,
    };
  }

  // List — medium budget, scales with requested count
  if (LIST_PATTERN.test(text)) {
    const countMatch = text.match(/(?:give me|show me|top|best|list)\s+(\d+)/i);
    const requested = countMatch ? Math.min(50, Number(countMatch[1]) || 5) : 10;
    return {
      shape: "list",
      tokenBudget: Math.max(400, Math.min(2000, requested * 80)),
      needsTool: familyHits.length > 0,
      factualHints: familyHits,
    };
  }

  // Explain / tell me about — medium-long budget
  if (EXPLAIN_PATTERN.test(text)) {
    return {
      shape: "explain",
      tokenBudget: 700,
      needsTool: familyHits.length > 0,
      factualHints: familyHits,
    };
  }

  // Default — rely on mode
  return {
    shape: "default",
    tokenBudget: 0, // 0 means "don't override, use mode default"
    needsTool: familyHits.length > 0 && isFactualCounter,
    factualHints: familyHits,
  };
}

/**
 * Compose a one-line directive prepended to the system prompt when the
 * query is factual and Nick has tools for it. Keeps Nick from guessing.
 */
export function toolFirstDirective(result: ShapeResult): string | null {
  if (!result.needsTool) return null;
  if (result.factualHints.length === 0) return null;
  const families = result.factualHints.slice(0, 3).join(", ");
  return `DATA QUERY · family=${families}. Call the appropriate tool FIRST, use the real numbers in your answer. Never guess a count, name, date, or amount — if the tool fails, say so plainly.`;
}
