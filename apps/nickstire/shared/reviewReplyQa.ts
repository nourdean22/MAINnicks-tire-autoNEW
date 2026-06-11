/**
 * Review-reply claim-safety QA — shared by the reviewReplies router
 * (approve gate), the review-monitor cron (draft prompt rules), and the
 * Growth admin UI (live findings on draft cards).
 *
 * Review replies are PUBLIC customer-facing copy on Google — the same
 * claim rules as the GBP Q&A seeds apply: no invented promises, no
 * prices, no corporate adjectives. Patterns live here (shared/ scope)
 * on purpose: this is detector configuration, not customer-facing copy.
 *
 * Severity model:
 *   block — the approve mutation refuses; the operator edits the draft.
 *   warn  — shown in the UI; the operator decides. Kept separate so the
 *           blocking tier stays high-precision (a false-positive block
 *           on the owner's phone kills the whole workflow).
 */

export interface ReplyQaFinding {
  severity: "block" | "warn";
  rule: string;
  match: string;
  fix: string;
}

interface PatternRule {
  rule: string;
  pattern: RegExp;
  fix: string;
}

/** Hard blockers — never paste these into a public Google reply. */
export const REPLY_BLOCK_PATTERNS: PatternRule[] = [
  {
    rule: "no-guarantees",
    pattern: /\bguarantee[ds]?\b/i,
    fix: "Remove guarantees entirely.",
  },
  {
    rule: "no-warranty-talk",
    pattern: /\bwarrant(?:y|ies)\b/i,
    fix: "Warranty terms stay out of public replies — handle specifics on a call.",
  },
  {
    rule: "no-free-claims",
    pattern: /\bfree\b(?!\s*checks?\b)/i,
    fix: "Only 'free check' is approved free-wording.",
  },
  {
    rule: "no-best-claims",
    pattern: /\bbest\s+(?:tire\s+)?shop\b|\bbest\s+in\s+(?:town|cleveland|euclid)\b|#1\b/i,
    fix: "Let the star rating do the talking — never self-rank.",
  },
  {
    rule: "no-wait-time-promises",
    pattern: /\b(?:in|under|within)\s+\d+\s*(?:minutes?|mins?|hours?)\b/i,
    fix: "Never put wait-time numbers in writing — prospects read replies as promises.",
  },
  {
    rule: "no-price-talk",
    pattern: /\$\s?\d/,
    fix: "No prices in public review replies — pricing belongs on a call.",
  },
];

/** Soft flags — the operator sees these and decides. */
export const REPLY_WARN_PATTERNS: PatternRule[] = [
  {
    rule: "kill-word",
    pattern: /\b(?:trusted|quality|premium|top.?notch|hassle.?free|state.of.the.art|comprehensive)\b/i,
    fix: "Fake-corporate adjective — name the concrete thing instead.",
  },
  {
    rule: "bot-phrase",
    pattern: /\b(?:rest assured|we apologize for any inconvenience|valued customer)\b/i,
    fix: "Sounds like a bot — say it like a neighborhood shop.",
  },
  {
    rule: "same-day",
    pattern: /\bsame.?day\b/i,
    fix: "No same-day promises in writing (brand rule). Recounting a past visit? Rephrase as 'that day'.",
  },
];

/** Run both banks over a reply draft. Pure. */
export function checkReviewReply(text: string): ReplyQaFinding[] {
  const findings: ReplyQaFinding[] = [];
  for (const r of REPLY_BLOCK_PATTERNS) {
    const m = text.match(r.pattern);
    if (m) findings.push({ severity: "block", rule: r.rule, match: m[0], fix: r.fix });
  }
  for (const r of REPLY_WARN_PATTERNS) {
    const m = text.match(r.pattern);
    if (m) findings.push({ severity: "warn", rule: r.rule, match: m[0], fix: r.fix });
  }
  return findings;
}

export function hasBlockingFindings(findings: ReplyQaFinding[]): boolean {
  return findings.some((f) => f.severity === "block");
}

/**
 * Single source of truth for the claim rules both AI draft prompts embed
 * (reviewReplies.fetchNewReviews + the review-monitor cron). Keeping the
 * prompt rules next to the detector means a draft that follows the prompt
 * also passes the approve gate.
 */
export function buildReplyPromptRules(): string {
  return [
    "Hard rules — the reply is posted publicly on Google:",
    "- Never promise guarantees, warranties, specific prices, or wait times.",
    "- The only approved 'free' wording is 'free check'.",
    "- No corporate adjectives (trusted, quality, premium, top-notch) — sound like a neighborhood shop: concrete and plain.",
    "- Never blame the customer; never argue with the review.",
    "- No same-day promises.",
  ].join("\n");
}
