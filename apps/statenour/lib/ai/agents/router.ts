/**
 * lib/ai/agents/router.ts · Task #13 · specialist sub-agent router.
 *
 * Two-pass classifier:
 *   1. FAST PATH · zero-cost keyword/regex scan against the latest
 *      user message. If exactly ONE domain matches → return immediately.
 *      If NONE match → return "general" immediately.
 *      If MULTIPLE match (ambiguous) → fall through to LLM.
 *
 *   2. LLM PATH · cheap `taskType: "classify"` aiChat call. The model
 *      sees a strict JSON instruction + the latest user message + a
 *      short rubric. Output is parsed via extractJsonObject so a
 *      malformed reply silently falls back to "general".
 *
 * GATING · process.env.ENABLE_SPECIALIST_ROUTING must literally equal
 * "true". Anything else (unset, "0", "false", "shadow") short-circuits
 * to general. Same shape as NICK_PRIME_PROMPT in system-prompt.ts —
 * known pattern in this codebase.
 *
 * Tracing · the LLM-path call goes through makeTracedAiChat so it
 * shows up in /system/agent-traces under label "specialist-router".
 */

import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import {
  isSpecialistRoutingEnabled,
  type RoutingDecision,
  type SpecialistInput,
  type SpecialistRoute,
} from "./types";

/**
 * Keyword signals · ANCHORED to high-intent terms only. We'd rather
 * route to general than mis-classify into a specialist. The LLM
 * fallback handles the genuinely ambiguous cases.
 */
const FINANCIAL_SIGNALS =
  /\b(net.?worth|savings? rate|saving rate|spending|spend(ing)? categor|money flow|cash ?flow|portfolio|investment portfolio|wealth|expense|expenses|income|paycheck|paychecks|debt(?!ug)|budgeting|monthly budget|financial snapshot|financialsnapshot|financial goal)\b/i;

const DECISION_SIGNALS =
  /\b(should i|should we|trade.?off|tradeoff|weigh(ing)? (the )?options|past nour|past[- ]?me|decision (criteria|grade|review|replay|history)|recovery path|deliberate|grade this decision|name the trade.?off|ghost[- ]?nour|ghost[- ]?me)\b/i;

const SCHEDULE_SIGNALS =
  /\b(when can i|when am i (free|available|open|booked)|schedule (a|the|that|this|my|in)|re[- ]?schedule|free (block|slot|window|hour|time)|(deep|focus|time)[- ]?block|overcommitted|overscheduled|too packed|too booked|push (it|this|that)[^.]{0,40}\b(to|until)\b[^.]{0,40}(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month)|move (it|this|that)[^.]{0,40}\b(to|until)\b[^.]{0,40}(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month)|my calendar|on my calendar|fit (a|the|that|this) .{0,40}(into|in)\b)/i;

const MARKETING_SIGNALS =
  /\b(marketing|seo|aeo|copywriting|campaign|social media|ad copy|newsletter|funnel|growth hack|brand voice|content strategy|tiktok strategy|weibo strategy|instagram curator|email strategist|reddit community|bilibili content|baidu seo|app store optimizer)\b/i;

const aiChat = makeTracedAiChat("specialist-router", "brain");

/**
 * Return the latest message authored by the user, or null if none.
 */
function lastUserContent(messages: SpecialistInput["messages"]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string") {
      return m.content;
    }
  }
  return null;
}

interface LlmClassification {
  route: SpecialistRoute;
  confidence: number;
  reason: string;
}

const CLASSIFY_SYSTEM_PROMPT = `You are a routing classifier. Given a user message you decide which agent should handle it.

Five possible routes:
- "financial-analyst" · the user is asking about money, net worth, savings rate, spending categories, cash flow, debt, investment portfolio, monthly budget, or income trends. Pure financial-data questions.
- "decision-coach" · the user is asking for help thinking through a CHOICE. Trade-offs, "should I", weighing options, decision criteria, recovery paths, referencing past decisions or past-self patterns.
- "schedule-keeper" · the user is asking about the SHAPE OF THEIR TIME — when to do a task, where to fit something in their day/week, free blocks, rescheduling, day rhythm, overcommitment. Time-placement questions, not choice-framing.
- "marketing-director" · the user is asking about marketing, search engine optimization (SEO), answer engine optimization (AEO), copywriting, ad campaigns, social media strategy, growth hacking, newsletter funnels, or brand voice auditing.
- "general" · everything else · greetings, tasks, brain dumps, business/shop ops, content writing, code, casual chat, mixed topics.

Distinguishing schedule-keeper from decision-coach: schedule-keeper is "when / where to place this in time" · decision-coach is "which option / should I do X". "Should I reschedule the meeting?" → decision-coach. "Reschedule my meeting to Thursday" → schedule-keeper.

Reply with STRICT JSON only, no markdown, no commentary:
{ "route": "general" | "financial-analyst" | "decision-coach" | "schedule-keeper" | "marketing-director", "confidence": 0..1, "reason": "short explanation under 80 chars" }

When in doubt, choose "general". Specialists are narrow.`;

async function classifyViaLlm(userContent: string): Promise<RoutingDecision> {
  try {
    const result = await aiChat(
      [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: userContent.slice(0, 1500) },
      ],
      "classify",
    );

    // Provider sentinel · graceful-degradation reply means we couldn't
    // classify · fall through to general so nothing breaks.
    if (result.provider === "none" || result.provider === "emergency") {
      return {
        route: "general",
        reason: "classifier provider unavailable",
        confidence: 0.5,
      };
    }

    const parsed = extractJsonObject<LlmClassification>(result.content);
    if (!parsed.ok) {
      return {
        route: "general",
        reason: `classifier parse failed (${parsed.error.slice(0, 60)})`,
        confidence: 0.5,
      };
    }

    const route =
      parsed.value.route === "financial-analyst" ||
      parsed.value.route === "decision-coach" ||
      parsed.value.route === "schedule-keeper" ||
      parsed.value.route === "marketing-director"
        ? parsed.value.route
        : "general";
    const confidence =
      typeof parsed.value.confidence === "number" &&
      parsed.value.confidence >= 0 &&
      parsed.value.confidence <= 1
        ? parsed.value.confidence
        : 0.6;
    const reason =
      typeof parsed.value.reason === "string" && parsed.value.reason.length > 0
        ? `llm: ${parsed.value.reason.slice(0, 80)}`
        : "llm classified";

    return { route, reason, confidence };
  } catch (err) {
    // Never let routing failure block the chat path.
    return {
      route: "general",
      reason: `classifier threw (${err instanceof Error ? err.message.slice(0, 50) : "unknown"})`,
      confidence: 0.5,
    };
  }
}

/**
 * Classify the latest user message in the input. Returns a routing
 * decision the dispatcher should respect.
 *
 * When ENABLE_SPECIALIST_ROUTING is not "true", returns general
 * UNCONDITIONALLY · the entire specialist layer is dead code until
 * the operator flips the flag.
 */
export async function routeMessage(
  input: SpecialistInput,
): Promise<RoutingDecision> {
  // Hard short-circuit · feature flag off.
  if (!isSpecialistRoutingEnabled()) {
    return {
      route: "general",
      reason: "routing-disabled",
      confidence: 1,
    };
  }

  const userContent = lastUserContent(input.messages);
  if (!userContent) {
    return {
      route: "general",
      reason: "no user message",
      confidence: 1,
    };
  }

  // ── Pass 1 · keyword pre-filter ──
  // Four specialist families · each has its own anchored signal regex.
  // If exactly ONE family hits → return immediately · cheap path.
  // If TWO+ families hit on the same message → ambiguous · LLM tiebreak.
  // If ZERO families hit → general · skip the LLM call.
  const hitsFinancial = FINANCIAL_SIGNALS.test(userContent);
  const hitsDecision = DECISION_SIGNALS.test(userContent);
  const hitsSchedule = SCHEDULE_SIGNALS.test(userContent);
  const hitsMarketing = MARKETING_SIGNALS.test(userContent);
  const hitCount =
    (hitsFinancial ? 1 : 0) +
    (hitsDecision ? 1 : 0) +
    (hitsSchedule ? 1 : 0) +
    (hitsMarketing ? 1 : 0);

  if (hitCount === 0) {
    return {
      route: "general",
      reason: "keyword: no specialist signals",
      confidence: 0.95,
    };
  }
  if (hitCount === 1) {
    if (hitsFinancial) {
      return {
        route: "financial-analyst",
        reason: "keyword: financial signals matched",
        confidence: 0.9,
      };
    }
    if (hitsDecision) {
      return {
        route: "decision-coach",
        reason: "keyword: decision signals matched",
        confidence: 0.9,
      };
    }
    if (hitsSchedule) {
      return {
        route: "schedule-keeper",
        reason: "keyword: schedule signals matched",
        confidence: 0.9,
      };
    }
    return {
      route: "marketing-director",
      reason: "keyword: marketing signals matched",
      confidence: 0.95,
    };
  }

  // ── Pass 2 · LLM classifier · only fires when 2+ regex families
  // matched the same message (ambiguous · e.g. "should I push myself
  // to save more money?" hits financial + decision · "when should I
  // schedule the budget review?" hits schedule + decision). Cheap ·
  // taskType=classify.
  return classifyViaLlm(userContent);
}

/**
 * Test/dev helper · returns the keyword-only verdict without touching
 * the LLM path or the env flag. Used in router tests + diagnostics.
 *
 * Mirrors the keyword phase of routeMessage() · 2+ family hits return
 * "general · ambiguous" (the real router would tiebreak via LLM ·
 * this helper short-circuits to a deterministic answer).
 */
export function classifyByKeyword(userContent: string): RoutingDecision {
  const hitsFinancial = FINANCIAL_SIGNALS.test(userContent);
  const hitsDecision = DECISION_SIGNALS.test(userContent);
  const hitsSchedule = SCHEDULE_SIGNALS.test(userContent);
  const hitsMarketing = MARKETING_SIGNALS.test(userContent);
  const hitCount =
    (hitsFinancial ? 1 : 0) +
    (hitsDecision ? 1 : 0) +
    (hitsSchedule ? 1 : 0) +
    (hitsMarketing ? 1 : 0);
  if (hitCount >= 2) {
    return {
      route: "general",
      reason: "keyword: ambiguous (multiple families matched)",
      confidence: 0.4,
    };
  }
  if (hitsFinancial) {
    return {
      route: "financial-analyst",
      reason: "keyword: financial signals matched",
      confidence: 0.9,
    };
  }
  if (hitsDecision) {
    return {
      route: "decision-coach",
      reason: "keyword: decision signals matched",
      confidence: 0.9,
    };
  }
  if (hitsSchedule) {
    return {
      route: "schedule-keeper",
      reason: "keyword: schedule signals matched",
      confidence: 0.9,
    };
  }
  if (hitsMarketing) {
    return {
      route: "marketing-director",
      reason: "keyword: marketing signals matched",
      confidence: 0.95,
    };
  }
  return {
    route: "general",
    reason: "keyword: no specialist signals",
    confidence: 0.95,
  };
}
