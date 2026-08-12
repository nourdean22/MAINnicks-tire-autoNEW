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
import type { ResponseContract } from "./response-contract";

export interface GateDecision {
  shouldRegen: boolean;
  reasons: string[];
  /** Severity 0-100. Higher = more urgent regen. */
  severity: number;
  signals: {
    empty: boolean;
    stubReply: boolean;
    iDontKnow: boolean;
    /** 2026-08-11 · the IDK carried its evidence (checked a source, cites
     *  what came back empty) — grounded honesty, never a regen offense. */
    evidencedUncertainty: boolean;
    subQuestionMiss: boolean;
    hedgeStorm: boolean;
  };
}

// Pattern libraries
const STUB_REPLY_RE = /^(ok(?:ay)?|sure|yep|no problem|got it|understood|noted)[.!?]?$/i;
const I_DONT_KNOW_RE =
  /\b(i (don'?t|do not) (know|have (that|this|the)? (info|data|information))|can'?t (tell|answer|help)|i'?m not sure|i have no (info|data|record))/i;
// 2026-08-11 · evidence markers that turn an IDK into grounded honesty:
// the reply names what was checked and that it came back empty, or cites
// a brain anchor. Penalizing THESE rewarded guessing — the failure is
// "I don't know" with no retrieval attempt, not uncertainty itself.
const EVIDENCED_UNCERTAINTY_RE =
  /\b(no (record|row|entry|match|result)s? (of|for|in)\b|nothing (in|on file|recorded|logged)\b|(found|returned|came up with) (nothing|no (rows?|results?|records?|matches?))|came up empty|evidence (doesn'?t|does not|can'?t|cannot) (establish|support|confirm)|(data|records?|logs?|memory|brain|database|db|system) (doesn'?t|does not|has no|shows? no|show(s|ing)? nothing)|couldn'?t find (it|that|any|anything)\b|not in the (system|db|database|records?|logs?|brain))\b/i;
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
  const evidencedUncertainty =
    iDontKnow && (EVIDENCED_UNCERTAINTY_RE.test(text) || text.includes("[brain:"));
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
  // 2026-08-11 · fixed incentive: only an UNGROUNDED IDK (no evidence of a
  // retrieval attempt) is a regen offense. "I don't know — checked, no
  // record" is the truth protocol working; pushing regen there taught the
  // model that guessing scores better than verified uncertainty.
  if (
    iDontKnow &&
    !evidencedUncertainty &&
    (turnSignal.intent === "factual" || turnSignal.intent === "decision")
  ) {
    severity = Math.max(severity, 60);
    reasons.push("I-don't-know on factual/decision turn (no evidence of a check)");
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
      evidencedUncertainty,
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

// ── CONTRACT-AWARE GATE — 2026-06-09 ─────────────────────────────────
/**
 * Extends runReplyGate with request-COMPLIANCE checks the base gate +
 * output-critic don't capture: did the reply honor what Nour explicitly
 * asked for (concise / a copy-paste prompt / top-N / repo-grounded /
 * don't-ask)? output-critic scores UNIVERSAL quality; this scores
 * REQUEST FIT against the per-turn ResponseContract.
 *
 * Backward compatible: runReplyGate is untouched; this is a new wrapper.
 * Pure — same inputs, same decision.
 */
export interface ContractGateDecision extends GateDecision {
  contractSignals: {
    conciseButBloated: boolean;
    promptNotCopyable: boolean;
    rankCountMismatch: boolean;
    repoGroundedButGeneric: boolean;
    askedDespiteNoAsk: boolean;
    vagueNonCompletion: boolean;
  };
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Count numbered or bulleted list items in a reply. */
function countListItems(reply: string): number {
  return reply.split(/\n/).filter((l) => /^\s*(\d+[.)]|[-*•])\s+\S/.test(l)).length;
}

/** Does the reply contain a fenced code block (a copy-pasteable prompt)? */
function hasFencedBlock(reply: string): boolean {
  return (reply.match(/```/g)?.length ?? 0) >= 2;
}

const CLARIFY_RE =
  /\b(could you (clarify|specify|tell me)|do you want me to|would you like me to|which (one|option|of these)|can you (clarify|confirm)|what (exactly )?do you mean|should i (do|use|pick|go with)|let me know (which|what|if you)|just to (confirm|clarify))\b/i;
/** Does the reply ask the user a clarifying question? */
function asksClarifying(reply: string): boolean {
  return /\?/.test(reply) && CLARIFY_RE.test(reply);
}

const VAGUE_OFFER_RE =
  /\b(i can (help|do|assist|look into|take care of)|i'?d be happy to|happy to (help|assist)|let me know if you(?:'?d| would)? (want|like)|would you like me to|i'?m able to)\b/i;
/** Vague offer instead of doing the work ("I can help with that."). */
function isVagueNonCompletion(reply: string): boolean {
  return wordCount(reply) < 45 && VAGUE_OFFER_RE.test(reply);
}

/** Repo-grounding signals: file paths, code identifiers, dir refs. */
function hasRepoGrounding(reply: string): boolean {
  if (/\b[\w/.-]+\.(ts|tsx|js|jsx|prisma|sql|json|md)\b/.test(reply)) return true; // file ext
  if (/\b(lib|app|components|prisma|scripts|tests)\//.test(reply)) return true; // dir
  if ((reply.match(/`[^`]+`/g)?.length ?? 0) >= 2) return true; // >=2 code spans
  return false;
}

export function runReplyGateWithContract(
  reply: string,
  userText: string,
  critic: CriticScore | null,
  turnSignal: TurnSignal,
  contract: ResponseContract,
): ContractGateDecision {
  const base = runReplyGate(reply, userText, critic, turnSignal);
  const text = reply.trim();
  const wc = wordCount(text);
  const reasons = [...base.reasons];
  let severity = base.severity;

  // 1. Concise requested but reply bloated.
  const conciseCap = contract.length === "ultra_concise" ? 45 : 130;
  const conciseButBloated =
    (contract.length === "ultra_concise" || contract.length === "concise") && wc > conciseCap;
  if (conciseButBloated) {
    severity = Math.max(severity, 60);
    reasons.push(`concise requested but reply is ${wc} words (cap ~${conciseCap})`);
  }

  // 2. Copy-paste prompt requested but reply has no fenced block.
  const promptNotCopyable = contract.answerMode === "copy_paste_prompt" && !hasFencedBlock(text);
  if (promptNotCopyable) {
    severity = Math.max(severity, 70);
    reasons.push("prompt requested but reply has no copy-paste code block");
  }

  // 3. Top-N requested but reply item count mismatches.
  let rankCountMismatch = false;
  if (contract.rankCount !== null) {
    const items = countListItems(text);
    rankCountMismatch = items !== contract.rankCount;
    if (rankCountMismatch) {
      severity = Math.max(severity, 55);
      reasons.push(`top-${contract.rankCount} requested but reply has ${items} list items`);
    }
  }

  // 4. Repo-grounded requested but reply is generic.
  const repoGroundedButGeneric =
    contract.mustBeRepoGrounded && !hasRepoGrounding(text) && wc > 12;
  if (repoGroundedButGeneric) {
    severity = Math.max(severity, 60);
    reasons.push("repo-grounded requested but reply cites no files/code");
  }

  // 5. Told not to ask, but the reply asks a clarifying question.
  const askedDespiteNoAsk = !contract.shouldAskClarifying && asksClarifying(text);
  if (askedDespiteNoAsk) {
    severity = Math.max(severity, 65);
    reasons.push("clarification suppressed but reply asks a clarifying question");
  }

  // 6. Vague "I can…" non-completion.
  const vagueNonCompletion = isVagueNonCompletion(text);
  if (vagueNonCompletion) {
    severity = Math.max(severity, 55);
    reasons.push("vague offer instead of completing the ask");
  }

  return {
    ...base,
    severity,
    reasons,
    shouldRegen: severity >= 50,
    contractSignals: {
      conciseButBloated,
      promptNotCopyable,
      rankCountMismatch,
      repoGroundedButGeneric,
      askedDespiteNoAsk,
      vagueNonCompletion,
    },
  };
}
