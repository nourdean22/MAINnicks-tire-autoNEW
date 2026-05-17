/**
 * REPLY GATE — Apr 19.
 *
 * Post-stream analysis that decides whether a reply deserves a regen
 * suggestion. Combines the output critic score with additional quality
 * signals the critic doesn't capture:
 *
 *   1. Empty / stub detection
 *   2. "I don't know" surface
 *   3. Unanswered-question count (model replied to 1 of 3 sub-questions)
 *   4. Suspicious numeric claims (numbers that weren't in the prompt AND
 *      don't appear in the brain context that fired)
 *
 * This is a LIGHT gate — we don't auto-regen. We flag and let Nour
 * decide via the UI quality badge ("regen recommended").
 *
 * Heavier gates (fact-check against brain memory) live in fact-check.ts.
 */

import type { CriticScore } from "./output-critic";
import type { TurnSignal } from "./turn-intelligence";

export interface GateDecision {
  shouldRegen: boolean;
  reasons: string[];
  /** Severity 0-100. Higher = more urgent regen. */
  severity: number;
  signals: {
    empty: boolean;
    stubReply: boolean;
    iDontKnow: boolean;
    subQuestionMiss: boolean;
    hedgeStorm: boolean;
  };
}

// Pattern libraries
const STUB_REPLY_RE = /^(ok(?:ay)?|sure|yep|no problem|got it|understood|noted)[.!?]?$/i;
const I_DONT_KNOW_RE =
  /\b(i (don'?t|do not) (know|have (that|this|the)? (info|data|information))|can'?t (tell|answer|help)|i'?m not sure|i have no (info|data|record))/i;
const HEDGE_RE =
  /\b(perhaps|maybe|possibly|might|could be|it'?s possible|i think|i believe|seemingly|apparently)\b/gi;

function countSentences(text: string): number {
  if (!text) return 0;
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 3).length;
}

function countSubQuestions(userText: string): number {
  if (!userText) return 0;
  // Multiple ?s OR obvious "and also"/"plus" conjunctions count as
  // multiple asks. Conservative — we only want to flag "Nick answered
  // 1 of 3" when the ask clearly had more than one part.
  const qMarks = (userText.match(/\?/g) ?? []).length;
  const conjunctions = (
    userText.match(/\b(and also|plus|additionally|furthermore|moreover|on top of)\b/gi) ?? []
  ).length;
  return Math.max(qMarks, conjunctions + 1);
}

/**
 * Run the gate. Pure function — same inputs produce same decision.
 */
export function runReplyGate(
  reply: string,
  userText: string,
  critic: CriticScore | null,
  turnSignal: TurnSignal,
): GateDecision {
  const reasons: string[] = [];
  const text = reply.trim();
  const isEmpty = text.length === 0;
  const isStubReply = !isEmpty && text.length < 40 && STUB_REPLY_RE.test(text);
  const iDontKnow = I_DONT_KNOW_RE.test(text);
  const hedgeCount = (text.match(HEDGE_RE) ?? []).length;
  const hedgeStorm = hedgeCount >= 4;

  // Sub-question miss: user asked 3+ things, reply has < 2 sentences
  const asks = countSubQuestions(userText);
  const sentences = countSentences(text);
  const subQuestionMiss = asks >= 3 && sentences < 2;

  let severity = 0;

  if (isEmpty) {
    severity = 100;
    reasons.push("empty reply");
  }
  if (isStubReply && turnSignal.intent !== "casual") {
    severity = Math.max(severity, 80);
    reasons.push("stub reply on non-casual turn");
  }
  if (iDontKnow && (turnSignal.intent === "factual" || turnSignal.intent === "decision")) {
    severity = Math.max(severity, 60);
    reasons.push("I-don't-know on factual/decision turn");
  }
  if (subQuestionMiss) {
    severity = Math.max(severity, 65);
    reasons.push(`sub-question miss (asked ≥3, replied ${sentences} sentences)`);
  }
  if (hedgeStorm) {
    severity = Math.max(severity, 45);
    reasons.push(`hedge storm (${hedgeCount} hedges)`);
  }

  // Absorb the critic's verdict. If critic already flagged regen, gate
  // does too. Severity = max so critic's signal can override ours.
  if (critic && critic.shouldRegen) {
    severity = Math.max(severity, 100 - critic.overall);
    reasons.push(`critic score ${critic.overall}/100`);
  }

  return {
    shouldRegen: severity >= 50,
    reasons,
    severity,
    signals: {
      empty: isEmpty,
      stubReply: isStubReply,
      iDontKnow,
      subQuestionMiss,
      hedgeStorm,
    },
  };
}

/**
 * One-line log summary.
 */
export function formatGateSummary(gate: GateDecision): string {
  if (gate.severity === 0) return "gate: clean";
  const flags = Object.entries(gate.signals)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(",");
  return `gate: severity=${gate.severity}${flags ? ` flags=${flags}` : ""}${gate.shouldRegen ? " REGEN" : ""}`;
}
