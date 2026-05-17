/**
 * AMBIGUITY DETECTOR — for content-mode prompts.
 *
 * v6 · Apr 28 · Confidence-layer feature #4. Reads a content-asking
 * prompt and decides whether Nick should ASK ONE smart question before
 * generating, or just SHIP with sensible defaults.
 *
 * Variables Nick needs to commit to before producing good content:
 *   1. SUBJECT — what service/topic? (brakes, tires, alignment...)
 *   2. FORMAT — post / reel / story / carousel / ad / email?
 *   3. ANGLE — what persuasion lever? (pain / proof / scarcity / alert / myth / value)
 *   4. URGENCY — when does this need to ship? (today / this week / no rush)
 *   5. AUDIENCE — Cleveland regular / first-time / long-time customer / dealer-disappointed?
 *
 * Rules:
 *   · 0-1 missing → SHIP with defaults
 *   · 2 missing AND prompt > 30 words → ASK ONE focused question
 *   · 3+ missing → ASK ONE focused question with 2-3 default options
 *   · ALWAYS ship if user said "just go" / "ship it" / "make something" / "decide"
 *
 * Output: { needsQuestion, question?, defaultsUsed, missingVars }
 *
 * Wired via system-prompt addendum in content mode. Nick reads the
 * recommendation and either asks a question or proceeds.
 */

const SUBJECT_RE = /\b(brake|rotor|caliper|pad|tire|tyre|tread|alignment|oil\s+change|engine\s+oil|rotation|diagnostic|engine\s+light|battery|alternator|starter|transmission|trans\s+fluid|suspension|strut|shock|coolant|radiator|filter|belt|spark\s+plug|ignition|ac|a\/c|inspection|safety|winter\s+tire|snow\s+tire|summer\s+tire|all-season)/i;

const FORMAT_RE = /\b(post|caption|reel|story|stories|carousel|video|ad|email|newsletter|blog|gbp|google\s+business|facebook|instagram|tiktok|tweet|thread|billboard|banner|flyer|sms|text)/i;

const ANGLE_RE = /\b(scarcity|urgent|limited|fomo|proof|customer|story|testimonial|review|pain|problem|hurt|noise|grinding|leak|wobble|myth|truth|fact|alert|warning|safety|value|education|how\s+to|why|what)/i;

const URGENCY_RE = /\b(today|tomorrow|this\s+week|by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|asap|now|right\s+away|tonight|this\s+morning|by\s+\d|before\s+\d|deadline)/i;

const AUDIENCE_RE = /\b(first[\s-]time|new\s+customer|loyal|long[\s-]time|regular|cleveland|euclid|local|dealer|chain|corporate|woman|mom|dad|family|fleet|business|commercial)/i;

const SHIP_NOW_PHRASES = [
  /\b(just\s+(go|ship|do\s+it|make\s+it|run\s+it))\b/i,
  /\b(ship\s+it|send\s+it|run\s+it)\b/i,
  /\b(decide|pick|choose)\s+(for\s+me|yourself)/i,
  /\b(your\s+call|whatever\s+(you|fits))/i,
  /\b(make\s+something|just\s+make|throw\s+together)/i,
  /\b(don'?t\s+ask|stop\s+asking|just\s+do)\b/i,
];

export type MissingVar = "subject" | "format" | "angle" | "urgency" | "audience";

export interface AmbiguityResult {
  needsQuestion: boolean;
  /** ONE focused question Nick should ask the user. Empty if needsQuestion=false. */
  question: string;
  /** 2-3 default options the question offers (parens-formatted by Nick). */
  defaultOptions: string[];
  /** Variables Nick will infer/default if user doesn't answer. */
  defaultsUsed: Record<MissingVar, string>;
  /** Which vars were absent in the prompt. */
  missingVars: MissingVar[];
}

const DEFAULT_VALUES: Record<MissingVar, string> = {
  subject: "tires (Nick's bread-and-butter)",
  format: "Instagram post (4:5)",
  angle: "value/education (educational pillar — safest default)",
  urgency: "no rush (queue for next slot)",
  audience: "Cleveland regular customer (default voice)",
};

const ANGLE_OPTIONS = [
  "scarcity (limited spots / today only)",
  "social-proof (recent customer story)",
  "pain (the noise/leak/wobble that ends here)",
  "alert (recall / safety warning)",
  "myth-busting (most shops do X — truth is Y)",
];

const FORMAT_OPTIONS = [
  "Instagram post (4:5)",
  "Reel script (9:16, ≤200c)",
  "Story slides (3 slides ≤80c)",
  "Carousel (5 scenes)",
  "GBP update (factual + offer)",
];

export function detectAmbiguity(message: string | null | undefined): AmbiguityResult {
  if (!message) {
    return {
      needsQuestion: false,
      question: "",
      defaultOptions: [],
      defaultsUsed: { ...DEFAULT_VALUES },
      missingVars: ["subject", "format", "angle", "urgency", "audience"],
    };
  }

  // SHIP-NOW override — user explicitly said don't ask, just go
  for (const re of SHIP_NOW_PHRASES) {
    if (re.test(message)) {
      return {
        needsQuestion: false,
        question: "",
        defaultOptions: [],
        defaultsUsed: { ...DEFAULT_VALUES },
        missingVars: [],
      };
    }
  }

  const missing: MissingVar[] = [];
  if (!SUBJECT_RE.test(message)) missing.push("subject");
  if (!FORMAT_RE.test(message)) missing.push("format");
  if (!ANGLE_RE.test(message)) missing.push("angle");
  if (!URGENCY_RE.test(message)) missing.push("urgency");
  if (!AUDIENCE_RE.test(message)) missing.push("audience");

  const wordCount = message.trim().split(/\s+/).length;

  // 0-1 missing → SHIP with defaults
  if (missing.length <= 1) {
    return {
      needsQuestion: false,
      question: "",
      defaultOptions: [],
      defaultsUsed: pickDefaults(missing),
      missingVars: missing,
    };
  }

  // 2 missing AND prompt < 30 words → ASK
  // 3+ missing → ASK
  if (missing.length >= 2 && (missing.length >= 3 || wordCount > 8)) {
    const { question, options } = pickQuestion(missing, message);
    return {
      needsQuestion: true,
      question,
      defaultOptions: options,
      defaultsUsed: pickDefaults(missing),
      missingVars: missing,
    };
  }

  // Edge case: exactly 2 missing but prompt is detailed — ship with defaults
  return {
    needsQuestion: false,
    question: "",
    defaultOptions: [],
    defaultsUsed: pickDefaults(missing),
    missingVars: missing,
  };
}

function pickDefaults(missing: MissingVar[]): Record<MissingVar, string> {
  const out: Record<MissingVar, string> = { ...DEFAULT_VALUES };
  // Only the missing vars matter; other defaults are inert
  for (const k of Object.keys(out) as MissingVar[]) {
    if (!missing.includes(k)) out[k] = "(specified by user)";
  }
  return out;
}

/**
 * Pick the SINGLE most valuable question to ask. Priority order:
 *   angle > format > subject > urgency > audience
 *
 * Angle is the highest-leverage choice — it changes the whole vibe.
 * Format is next — wrong format = wasted asset.
 */
function pickQuestion(missing: MissingVar[], _message: string): { question: string; options: string[] } {
  if (missing.includes("angle")) {
    return {
      question: "Which angle works for this — scarcity, social-proof, pain, alert, or myth-busting?",
      options: ANGLE_OPTIONS.slice(0, 3),
    };
  }
  if (missing.includes("format")) {
    return {
      question: "What format — Instagram post, reel, story, or carousel?",
      options: FORMAT_OPTIONS.slice(0, 3),
    };
  }
  if (missing.includes("subject")) {
    return {
      question: "Which service — brakes, tires, alignment, or oil change?",
      options: ["brakes", "tires", "alignment"],
    };
  }
  if (missing.includes("urgency")) {
    return {
      question: "Need it today, this week, or no rush?",
      options: ["today", "this week", "no rush"],
    };
  }
  return {
    question: "Cleveland regular, first-time, or long-time customer?",
    options: ["regular", "first-time", "long-time"],
  };
}

/**
 * Format the result as a system-prompt rule that the model reads
 * before generating. Returns a paragraph the chat route can append.
 */
export function buildAmbiguityPromptRule(result: AmbiguityResult): string {
  if (!result.needsQuestion) {
    if (result.missingVars.length === 0) {
      return "";
    }
    const defaultLines = result.missingVars
      .map((v) => `  · ${v}: ${result.defaultsUsed[v]}`)
      .join("\n");
    return `\n═══ INFERRED DEFAULTS (none missing enough to block) ═══\n${defaultLines}\n\nProceed with these. Tell the user what you defaulted in 1 line at the end.\n`;
  }
  const optsLine = result.defaultOptions.map((o, i) => `${i + 1}) ${o}`).join("  ");
  return `
═══ AMBIGUITY DETECTED — ASK ONE QUESTION FIRST ═══
The user's prompt is missing ${result.missingVars.length} key variable${result.missingVars.length === 1 ? "" : "s"}: ${result.missingVars.join(", ")}.

BEFORE generating any content, ask EXACTLY ONE focused question:

  "${result.question}"
  ${optsLine}

Format the question so the user can answer in 1 word. After they answer, ship the content. If user says "just go" / "your call" / "decide" — proceed with these defaults:
${(Object.entries(result.defaultsUsed) as Array<[MissingVar, string]>)
  .filter(([k]) => result.missingVars.includes(k))
  .map(([k, v]) => `  · ${k}: ${v}`)
  .join("\n")}

DO NOT ASK MULTIPLE QUESTIONS. ONE question. Then ship.
`;
}
