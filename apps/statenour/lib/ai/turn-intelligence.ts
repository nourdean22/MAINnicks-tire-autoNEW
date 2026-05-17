/**
 * Turn Intelligence — per-turn classification driving ALL downstream
 * reasoning choices. Apr 19.
 *
 * One pass over the user's text yields a dense signal that the chat
 * route uses to pick:
 *
 *   • Complexity      → triggers chain-of-thought scratchpad
 *   • Intent          → drives temperature choice
 *   • OutputShape     → picks output template (email/SMS/code/etc)
 *   • Domain          → biases tool pruning + context weighting
 *   • Urgency         → flags high-stakes turns for 2-pass critique
 *
 * Heuristic-only (zero AI call, <2ms). The payoff is huge: every
 * slow optimization downstream (CoT, critic, ensemble) only fires
 * when it actually matters. Simple "hi how are you" skips all of
 * them; "should I fire this employee" activates the full stack.
 */

export type TurnComplexity = "simple" | "moderate" | "complex";

export type TurnIntent =
  | "factual"        // "what's X", "how does Y work"
  | "analytical"     // "analyze", "compare", "should I"
  | "creative"       // "draft", "write me", "come up with"
  | "emotional"      // venting, feelings, relational
  | "instructional"  // "teach me", "walk me through"
  | "casual"         // "hi", "thanks", "cool"
  | "decision"       // "should I X or Y"
  | "procedural"     // "how do I X" with specific steps needed
  | "reflective";    // "why do I always", "I've been thinking";

export type OutputShape =
  | "prose"        // default
  | "email"
  | "sms"
  | "proposal"
  | "list"
  | "code"
  | "json"
  | "table"
  | "summary"
  | "none";        // fast casual reply

export interface TurnSignal {
  complexity: TurnComplexity;
  intent: TurnIntent;
  outputShape: OutputShape;
  urgency: "low" | "medium" | "high";
  domain: "business" | "personal" | "mixed" | "unknown";
  temperature: number;           // 0.1 - 0.9
  useChainOfThought: boolean;
  useTwoPassCritique: boolean;
  reasons: string[];             // human-readable flags
}

// ── Detector regexes ────────────────────────────────────────────────

const FACTUAL = [/\b(what'?s|what is|when did|where is|how many|how much|who (is|was|are))\b/i];
const ANALYTICAL = [/\b(analy[zs]e|compare|weigh|pros and cons|tradeoff|should i|what's better|which one)\b/i];
const CREATIVE = [/\b(draft|write (me )?(a|an|the)?|come up with|generate|suggest|brainstorm|ideas?)\b/i];
const EMOTIONAL = [/\b(feel|feeling|tired|stuck|overwhelmed|anxious|frustrated|stressed|vent|rant|just talk|hate when)\b/i];
const INSTRUCTIONAL = [/\b(teach me|walk me through|explain|how does (it|this|that) work)\b/i];
const CASUAL = [/^(hi|hey|yo|sup|thanks|thx|cool|ok|okay|got it|nice|lol|k)\s*[!.?]?$/i];
const DECISION = [/\b(should i|vs\.?|or |either|decide|which (one|should))\b/i];
const PROCEDURAL = [/\b(how do i|steps to|process for|workflow)\b/i];
const REFLECTIVE = [/\b(why do i|i always|i keep|i've been thinking|pattern|notice i)\b/i];

const URGENCY_HIGH = [
  /\b(urgent|asap|now|right now|immediately|emergency|critical|stuck|breaking|broken|fire|crisis)\b/i,
  /\?{2,}/,  // multiple question marks = anxious
  /!{2,}/,   // shouting
];

const BUSINESS = [
  /\b(revenue|customer|lead|estimate|quote|sales|shop|garage|nickstire|auto|labor|business|vendor|employee|payroll|margin|invoice|pay)\b/i,
];
const PERSONAL = [
  /\b(dania|mom|dad|family|friend|wife|workout|gym|sleep|eat|meal|journal|reflect|mind|body|soul)\b/i,
];

// Output shape cues
const EMAIL_CUES = /\b(email|write .{0,30}email|subject (line|:)|dear |best regards|cc |bcc )/i;
const SMS_CUES = /\b(text|sms|short message)\b/i;
const PROPOSAL_CUES = /\b(proposal|quote for|sow|scope of work|estimate for)\b/i;
const CODE_CUES = /\b(code|function|component|refactor|debug|ts|js|python|sql|fix the)\b|```/i;
const JSON_CUES = /\b(json|output as (json|object))\b/i;
const TABLE_CUES = /\b(table|spreadsheet|rows? and columns?|tabular)\b/i;
const LIST_CUES = /\b(list|top \d+|checklist|bullet)\b/i;
const SUMMARY_CUES = /\b(summari[sz]e|recap|tldr|condense|digest)\b/i;

// Complexity signals
function assessComplexity(text: string): TurnComplexity {
  const wordCount = text.trim().split(/\s+/).length;
  const hasQuestionStack = (text.match(/\?/g)?.length ?? 0) >= 2;
  const hasConditional = /\b(if .+, (then|should|would)|assuming|given that|suppose)\b/i.test(text);
  const hasMultiSubject = /\b(and also|plus|but also|on top of|furthermore|moreover)\b/i.test(text);
  const hasAnalysis = ANALYTICAL.some((p) => p.test(text)) || DECISION.some((p) => p.test(text));

  let score = 0;
  if (wordCount > 60) score += 2;
  else if (wordCount > 25) score += 1;
  if (hasQuestionStack) score += 1;
  if (hasConditional) score += 2;
  if (hasMultiSubject) score += 1;
  if (hasAnalysis) score += 2;

  if (score >= 5) return "complex";
  if (score >= 2) return "moderate";
  return "simple";
}

function detectIntent(text: string): TurnIntent {
  if (CASUAL.some((p) => p.test(text))) return "casual";
  if (EMOTIONAL.some((p) => p.test(text))) return "emotional";
  if (REFLECTIVE.some((p) => p.test(text))) return "reflective";
  if (DECISION.some((p) => p.test(text))) return "decision";
  if (PROCEDURAL.some((p) => p.test(text))) return "procedural";
  if (ANALYTICAL.some((p) => p.test(text))) return "analytical";
  if (CREATIVE.some((p) => p.test(text))) return "creative";
  if (INSTRUCTIONAL.some((p) => p.test(text))) return "instructional";
  if (FACTUAL.some((p) => p.test(text))) return "factual";
  return "factual"; // safe default
}

function detectOutputShape(text: string): OutputShape {
  if (EMAIL_CUES.test(text)) return "email";
  if (SMS_CUES.test(text)) return "sms";
  if (PROPOSAL_CUES.test(text)) return "proposal";
  if (CODE_CUES.test(text)) return "code";
  if (JSON_CUES.test(text)) return "json";
  if (TABLE_CUES.test(text)) return "table";
  if (LIST_CUES.test(text)) return "list";
  if (SUMMARY_CUES.test(text)) return "summary";
  if (CASUAL.some((p) => p.test(text))) return "none";
  return "prose";
}

function detectDomain(text: string): TurnSignal["domain"] {
  const biz = BUSINESS.some((p) => p.test(text));
  const pers = PERSONAL.some((p) => p.test(text));
  if (biz && pers) return "mixed";
  if (biz) return "business";
  if (pers) return "personal";
  return "unknown";
}

function detectUrgency(text: string): TurnSignal["urgency"] {
  if (URGENCY_HIGH.some((p) => p.test(text))) return "high";
  if (text.length < 30) return "low";
  return "medium";
}

/**
 * Map intent → temperature. Tight on factual, loose on creative,
 * medium on casual/decision.
 *
 * v10.0.481 · operator turned up creativity. Boosted the creative-
 * leaning intents (creative · casual · reflective · emotional ·
 * analytical · instructional) by 0.10-0.15 each. Strict precision
 * tasks (factual · decision · procedural) untouched — those need
 * deterministic output. Simple-casual cap raised 0.7 → 0.8 so
 * one-liner banter has more room to wander.
 */
function pickTemperature(intent: TurnIntent, complexity: TurnComplexity): number {
  const base: Record<TurnIntent, number> = {
    factual: 0.2,         // unchanged · facts must hold
    analytical: 0.45,     // 0.35 → 0.45 · room for novel framings
    decision: 0.3,        // unchanged · weighing must be calibrated
    procedural: 0.25,     // unchanged · step-by-step must be exact
    instructional: 0.5,   // 0.4 → 0.5 · explanations breathe more
    creative: 0.85,       // 0.75 → 0.85 · marketing / brainstorm
    emotional: 0.7,       // 0.6 → 0.7 · warmer when Nour vents
    reflective: 0.65,     // 0.55 → 0.65 · more divergent reflection
    casual: 0.6,          // 0.5 → 0.6 · conversational warmth
  };
  let t = base[intent] ?? 0.5;
  // Complex turns nudge slightly lower (need more determinism)
  if (complexity === "complex") t = Math.max(0.15, t - 0.05);
  // Simple casual turns can be warmer · v10.0.481 cap raised 0.7 → 0.8
  if (complexity === "simple" && intent === "casual") t = Math.min(0.8, t + 0.1);
  return Math.round(t * 100) / 100;
}

/**
 * Main classifier — single-pass, heuristic-only.
 */
export function classifyTurn(userText: string): TurnSignal {
  const text = userText.trim();
  const reasons: string[] = [];

  const complexity = assessComplexity(text);
  reasons.push(`complexity:${complexity}`);

  const intent = detectIntent(text);
  reasons.push(`intent:${intent}`);

  const outputShape = detectOutputShape(text);
  if (outputShape !== "prose" && outputShape !== "none") reasons.push(`shape:${outputShape}`);

  const domain = detectDomain(text);
  if (domain !== "unknown") reasons.push(`domain:${domain}`);

  const urgency = detectUrgency(text);
  if (urgency !== "medium") reasons.push(`urgency:${urgency}`);

  const temperature = pickTemperature(intent, complexity);

  // CoT when: complex turn OR analytical/decision/reflective intent
  const useChainOfThought =
    complexity === "complex" ||
    intent === "analytical" ||
    intent === "decision" ||
    intent === "reflective";

  // 2-pass critique for high-stakes decisions (rare; costs a full round)
  const useTwoPassCritique = urgency === "high" && (intent === "decision" || intent === "analytical");

  return {
    complexity,
    intent,
    outputShape,
    urgency,
    domain,
    temperature,
    useChainOfThought,
    useTwoPassCritique,
    reasons,
  };
}

/**
 * Build the CoT scratchpad system-prompt addition when enabled.
 * Instructs the model to reason explicitly before answering.
 */
export function buildChainOfThoughtPrompt(): string {
  return `## Reasoning protocol (use this for this turn)
Before you answer, think it through IN ORDER:
1. Parse Nour's ask into concrete sub-questions
2. Check what brain context already answers each sub-question
3. Note anything that feels uncertain — surface it explicitly
4. Pick the ONE next move that makes the rest obvious
5. ONLY THEN write the reply

Keep the reasoning tight. Surface it under a collapsible \`<details>\` block titled "how I got here" so Nour can expand if he wants. The reply proper comes AFTER the \`</details>\` tag.`;
}

/**
 * Build the output-shape prompt addition when a specific format is
 * detected (email / SMS / proposal / code / JSON / list / table /
 * summary).
 */
export function buildOutputShapePrompt(shape: OutputShape): string {
  switch (shape) {
    case "email":
      return "## Output format\nDraft a ready-to-send email. Include subject, greeting, 2-3 tight paragraphs, and a specific ask or next step. Don't include 'dear sir/madam' — if no recipient name, open with the first sentence directly.";
    case "sms":
      return "## Output format\nSMS: one line, ≤160 chars, friendly-but-direct. No greeting overhead, no sign-off.";
    case "proposal":
      return "## Output format\nProposal outline: problem, solution approach, deliverables, timeline, pricing basis. Each section 1-3 lines. End with 'next step' line.";
    case "code":
      return "## Output format\nReturn working code in a fenced block with language hint. Above the block: 1-sentence summary of what it does. Below: 1-sentence note on assumptions or edge cases.";
    case "json":
      return "## Output format\nReturn ONLY valid JSON. No markdown, no prose, no code fences. Parseable via JSON.parse.";
    case "table":
      return "## Output format\nUse a markdown table with clear headers. Cap at 10 rows. Follow with a 1-sentence takeaway.";
    case "list":
      return "## Output format\nReturn a numbered or bulleted list. Each item 1-2 lines max. Lead with the action verb.";
    case "summary":
      return "## Output format\nSummary: 3-5 sentences, dense with specifics (numbers, names, dates). No throat-clearing. End with the single most important takeaway.";
    case "none":
      return "## Output format\nCasual reply. 1-2 sentences max. Match Nour's tone.";
    default:
      return "";
  }
}
