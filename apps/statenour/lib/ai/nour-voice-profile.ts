/**
 * NOUR VOICE PROFILE — Apr 19.
 *
 * Style constants extracted from Nour's actual writing + the forensic
 * brand blueprint. Used by output-critic + system prompt assembly to
 * steer Nick toward Nour's real voice instead of generic-LLM output.
 *
 * Four pillars of Nour's voice (from memory/brand_rules.md + sales call
 * transcripts + chat history):
 *
 *   1. CONCRETE — specific numbers, names, dates. Not "several leads"
 *      but "3 unfollowed estimates from April".
 *   2. DIRECT — short sentences. No preamble. Lead with the verb.
 *   3. CONTROL-ORIENTED — action-to-outcome language. Not "consider X"
 *      but "do X, it gets you Y".
 *   4. FIRST-PERSON REAL — "I'm", "you're", "let's". Not "one might"
 *      or "the user should".
 *
 * Writing that hits all four reads like Nour wrote it. Writing that
 * misses multiple feels like ChatGPT answered.
 */

/**
 * Phrases Nour uses often — hit-words the critic rewards when they
 * appear in appropriate context. These come from chat history + sales
 * call transcripts.
 */
export const NOUR_HIT_WORDS: string[] = [
  // Action language
  "close",
  "ship",
  "move",
  "lock",
  "kill",
  "fire",
  "flip",
  "land",

  // Business specificity
  "estimate",
  "invoice",
  "drop-off",
  "walk-in",
  "callback",
  "booking",
  "labor guide",
  "autonicks",
  "nickstire",

  // Power/control
  "devastating",
  "relentless",
  "ruthless",
  "clean",
  "sharp",

  // Direct qualifiers
  "exactly",
  "specifically",
  "today",
  "this week",
];

/**
 * Specificity markers — a reply that cites at least one of these
 * per 100 words is grounded in reality. Zero markers = generic LLM
 * output.
 */
export const SPECIFICITY_PATTERNS: RegExp[] = [
  // v10.0.493 · widening pass · the prior set was tuned for
  // business-only nouns. The output-critic test at v10.0.490
  // exposed under-counting on technical specifics (ISO dates,
  // file paths, code refs, raw counts of non-business nouns).
  // The widened set lifts the spec-axis baseline without
  // changing reply quality · scores will adjust upward on the
  // /api/system/quality dashboard once new replies land.

  // Money + percentages
  /\$\d[\d,]*/,                           // dollar amounts
  /\b\d+%\b/,                             // percentages
  /\b\d+\s*bps\b/i,                       // basis points

  // Time windows + clocks + ISO dates
  /\b\d+\s*(days?|weeks?|months?|hrs?|hours?|mins?|minutes?|secs?|seconds?|ms|years?)\b/i, // time windows
  /\b\d{1,2}:\d{2}(\s?(am|pm))?\b/i,       // clock times
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,       // US dates (5/12 · 5/12/26)
  /\b\d{4}-\d{2}-\d{2}\b/,                  // ISO dates (2026-05-12) · v10.0.493 add
  /\b(today|tomorrow|yesterday|this (week|month|quarter|year)|last (week|month|quarter|year)|next (week|month|quarter|year))\b/i, // temporal anchors

  // Counts of business + technical nouns
  /\b\d+\s+(leads?|estimates?|invoices?|jobs?|cars?|customers?|bookings?|drops?)\b/i, // business counts
  /\b\d+\s+(rows?|records?|files?|commits?|prs?|pull requests?|issues?|errors?|warnings?|tests?|migrations?|tables?|columns?|indexes?|queries?|requests?|users?|sessions?|turns?|messages?|tokens?|calls?|handlers?|routes?|endpoints?|builds?|deploys?|versions?|packages?|deps?|dependencies?|imports?)\b/i, // v10.0.493 add · technical counts

  // Proper names
  /\b(Nick|Dania|Nour|Mom|Dad)\b/,         // operator-personal names
  /\b(Auto Labor Guide|autonicks|nickstire|Cloudflare|Venice|Vercel|Neon|Ollama|Anthropic|Prisma|Drizzle|TiDB|Railway|Tailwind|Next\.?js|React)\b/i, // system + stack names (v10.0.493 widened)

  // File paths + code references (v10.0.493 add)
  /\b[a-zA-Z_][a-zA-Z0-9_/.\-]*\.(ts|tsx|js|jsx|sql|md|json|yml|yaml|prisma|env)\b/, // file paths (e.g. lib/ai/critic.ts)
  /\b(scripts|app|lib|components|prisma|tests|server|client|drizzle|docs)\/[a-zA-Z0-9_/\-]+/, // dir/file refs
  /\b[A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]+)+\b/,  // PascalCase identifiers (MissionLink, BrainBusEvent · v10.0.493 add)
  /\b[a-z][a-zA-Z]*(?:[A-Z][a-zA-Z]*)+\b/,  // camelCase identifiers (shouldRegen, critiqueOutput)
  /\b(v\d+(\.\d+)*(\.\d+)?)\b/i,            // version refs (v10.0.490 · v1.6 · v8.x)

  // Counts + IDs in technical context
  /\b\d+\s*(LOC|loc|lines)\b/i,             // line-count refs (250 LOC)
  /\b#\d+\b/,                               // numeric refs (#1234 issue/PR refs)
  /\b[A-Z]{2,}-\d+\b/,                      // ticket refs (LINEAR-123 · NICK-42)

  // Database + numbers in context
  /\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:KB|MB|GB|TB|kb|mb|gb|tb|chars?|bytes?|requests?|qps|rps|RPM)\b/i, // sizes + rates
];

/**
 * Anti-Nour patterns — phrasing Nour would never use. These are milder
 * than cliches (those are universal LLM tells); these are specifically
 * "Nick-in-corporate-mode" slippage.
 */
export const ANTI_NOUR: RegExp[] = [
  /\bone should\b/i,
  /\bone might\b/i,
  /\bone could\b/i,
  /\bthe user\b/i,
  /\bthe individual\b/i,
  /\bstakeholders?\b/i,
  /\bend.?users?\b/i,
  /\butili[sz]e\b/i,              // Nour says "use"
  /\bimplement\b/i,                // Nour says "ship" / "build"
  /\bfacilitate\b/i,
  /\boptim(al|ally|ization)\b/i,   // Nour says "best" / "cleanly"
];

/**
 * Count specificity markers in a reply. Higher count = more grounded.
 * Proxy for "did Nick cite real data from brain context?"
 */
export function countSpecificity(text: string): number {
  let count = 0;
  for (const pat of SPECIFICITY_PATTERNS) {
    const matches = text.match(new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g"));
    count += matches?.length ?? 0;
  }
  return count;
}

/**
 * Specificity density: markers per 100 words. Above 2.0 is grounded;
 * below 0.5 is generic.
 */
export function specificityDensity(text: string): number {
  const count = countSpecificity(text);
  const words = text.trim().split(/\s+/).length;
  if (words === 0) return 0;
  return (count / words) * 100;
}

/**
 * Detect anti-Nour phrasing. Count = severity.
 */
export function detectAntiNour(text: string): { count: number; matches: string[] } {
  const matches: string[] = [];
  for (const pat of ANTI_NOUR) {
    const m = text.match(pat);
    if (m) matches.push(m[0]);
  }
  return { count: matches.length, matches };
}

/**
 * Build a style-guide block for the system prompt. Appended when the
 * turn's intent benefits from Nour-voice reinforcement (analytical /
 * decision / creative / reflective). Skipped for casual chat (adds
 * overhead without value on "thanks").
 */
export function buildNourVoicePrompt(): string {
  return `## Voice guardrails (Nour's actual style)
- CONCRETE: cite specific numbers, names, dates. "3 unfollowed April estimates" beats "several leads". Numbers are mandatory when the brain context has them.
- DIRECT: short sentences. Lead with the verb. No preamble.
- CONTROL-ORIENTED: action→outcome language. "Text Smith today, it unlocks the callback loop" beats "Consider texting Smith to improve response rates".
- FIRST-PERSON REAL: "you're", "I'd", "let's". Never "one might" or "the user".
- AVOID: utilize, implement (unless code), facilitate, optimize, stakeholders, end-users, "at the end of the day", "move the needle", "deep dive".`;
}
