/**
 * REPLY GATE — Apr 19.
 *
 * Post-stream analysis that decides whether a reply deserves a regen
 * suggestion. Combines the output critic score with additional quality
 * signals the critic doesn't capture.
 *
 * This is a LIGHT gate — we don't auto-regen. On the ordinary streaming
 * path the user has already seen the reply, so the value here is honest
 * telemetry plus persisted repair signals, never pretend blocking.
 */

import { detectBrevityRequest, type CriticScore } from "./output-critic";
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
    evidencedUncertainty: boolean;
    subQuestionMiss: boolean;
    hedgeStorm: boolean;
  };
}

const STUB_REPLY_RE = /^(ok(?:ay)?|sure|yep|no problem|got it|understood|noted)[.!?]?$/i;
const I_DONT_KNOW_RE =
  /\b(i (don'?t|do not) (know|have (that|this|the)? (info|data|information))|can'?t (tell|answer|help)|i'?m not sure|i have no (info|data|record))/i;
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
  const qMarks = (userText.match(/\?/g) ?? []).length;
  const conjunctions = (
    userText.match(/\b(and also|plus|additionally|furthermore|moreover|on top of)\b/gi) ?? []
  ).length;
  return Math.max(qMarks, conjunctions + 1);
}

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
  const brevityRequested = detectBrevityRequest(userText);
  const iDontKnow = I_DONT_KNOW_RE.test(text);
  const evidencedUncertainty =
    iDontKnow && (EVIDENCED_UNCERTAINTY_RE.test(text) || text.includes("[brain:"));
  const hedgeCount = (text.match(HEDGE_RE) ?? []).length;
  const hedgeStorm = hedgeCount >= 4;

  const asks = countSubQuestions(userText);
  const sentences = countSentences(text);
  const subQuestionMiss = asks >= 3 && sentences < 2;

  let severity = 0;
  if (isEmpty) {
    severity = 100;
    reasons.push("empty reply");
  }
  if (isStubReply && turnSignal.intent !== "casual" && !brevityRequested) {
    severity = Math.max(severity, 80);
    reasons.push("stub reply on non-casual turn");
  } else if (isStubReply && brevityRequested) {
    reasons.push("brevity-requested · stub-reply waived (operator-constrained reply)");
  }
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

export function formatGateSummary(gate: GateDecision): string {
  if (gate.severity === 0) return "gate: clean";
  const flags = Object.entries(gate.signals)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(",");
  return `gate: severity=${gate.severity}${flags ? ` flags=${flags}` : ""}${gate.shouldRegen ? " REGEN" : ""}`;
}

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

function countListItems(reply: string): number {
  return reply.split(/\n/).filter((l) => /^\s*(\d+[.)]|[-*•])\s+\S/.test(l)).length;
}

function hasFencedBlock(reply: string): boolean {
  return (reply.match(/```/g)?.length ?? 0) >= 2;
}

const CLARIFY_RE =
  /\b(could you (clarify|specify|tell me)|do you want me to|would you like me to|which (one|option|of these)|can you (clarify|confirm)|what (exactly )?do you mean|should i (do|use|pick|go with)|let me know (which|what|if you)|just to (confirm|clarify))\b/i;
function asksClarifying(reply: string): boolean {
  return /\?/.test(reply) && CLARIFY_RE.test(reply);
}

const VAGUE_OFFER_RE =
  /\b(i can (help|do|assist|look into|take care of)|i'?d be happy to|happy to (help|assist)|let me know if you(?:'?d| would)? (want|like)|would you like me to|i'?m able to)\b/i;
function isVagueNonCompletion(reply: string): boolean {
  return wordCount(reply) < 45 && VAGUE_OFFER_RE.test(reply);
}

function hasRepoGrounding(reply: string): boolean {
  if (/\b[\w/.-]+\.(ts|tsx|js|jsx|prisma|sql|json|md)\b/.test(reply)) return true;
  if (/\b(lib|app|components|prisma|scripts|tests)\//.test(reply)) return true;
  if ((reply.match(/`[^`]+`/g)?.length ?? 0) >= 2) return true;
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

  // One source of truth: generation and verification consume the exact same
  // per-turn hard ceiling. The historical field name stays for UI/backward
  // compatibility even though this now detects any response-budget breach.
  const conciseButBloated = wc > contract.hardMaxWords;
  if (conciseButBloated) {
    severity = Math.max(severity, 60);
    reasons.push(
      `response budget exceeded (${wc} words > ${contract.hardMaxWords} hard max; target ${contract.targetWords})`,
    );
  }

  const promptNotCopyable = contract.answerMode === "copy_paste_prompt" && !hasFencedBlock(text);
  if (promptNotCopyable) {
    severity = Math.max(severity, 70);
    reasons.push("prompt requested but reply has no copy-paste code block");
  }

  let rankCountMismatch = false;
  if (contract.rankCount !== null) {
    const items = countListItems(text);
    rankCountMismatch = items !== contract.rankCount;
    if (rankCountMismatch) {
      severity = Math.max(severity, 55);
      reasons.push(`top-${contract.rankCount} requested but reply has ${items} list items`);
    }
  }

  const repoGroundedButGeneric =
    contract.mustBeRepoGrounded && !hasRepoGrounding(text) && wc > 12;
  if (repoGroundedButGeneric) {
    severity = Math.max(severity, 60);
    reasons.push("repo-grounded requested but reply cites no files/code");
  }

  const askedDespiteNoAsk = !contract.shouldAskClarifying && asksClarifying(text);
  if (askedDespiteNoAsk) {
    severity = Math.max(severity, 65);
    reasons.push("clarification suppressed but reply asks a clarifying question");
  }

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

export type GateVerdict = "pass" | "repair" | "block";

export interface NamedSourceEvidence {
  unreceipted: ReadonlyArray<{ name: string }>;
  unearnedConfidenceTags: ReadonlyArray<string>;
  namedWithoutAnyTool: boolean;
  blind: boolean;
}

export interface GateEvidence {
  unverifiedFactCount: number;
  totalFactCount: number;
  wordCount: number;
  lengthCeiling: number;
  namedSources?: NamedSourceEvidence;
}

export interface EvidenceGateDecision extends ContractGateDecision {
  verdict: GateVerdict;
  blockingReasons: string[];
  evidenceSignals: {
    unverifiedFacts: boolean;
    unhedgedUnverifiedFacts: boolean;
    lengthOverrun: boolean;
    lengthRatio: number;
    fabricatedNamedSource: boolean;
    namedWithoutAnyTool: boolean;
    unearnedConfidenceTag: boolean;
    receiptsBlind: boolean;
  };
}

export const EVIDENCE_SEVERITY = {
  unverifiedHedged: 55,
  unverifiedUnhedged: 60,
  lengthOverrun: 55,
  unearnedTag: 65,
  namedWithoutAnyTool: 70,
  fabricatedNamedSource: 75,
} as const;

export const BLOCK_THRESHOLD = 70;
export const REPAIR_THRESHOLD = 50;
export const LENGTH_OVERRUN_RATIO = 1.5;

export function runEvidenceGate(
  reply: string,
  userText: string,
  critic: CriticScore | null,
  turnSignal: TurnSignal,
  contract: ResponseContract | null,
  evidence: GateEvidence,
): EvidenceGateDecision {
  const base = contract
    ? runReplyGateWithContract(reply, userText, critic, turnSignal, contract)
    : {
        ...runReplyGate(reply, userText, critic, turnSignal),
        contractSignals: {
          conciseButBloated: false,
          promptNotCopyable: false,
          rankCountMismatch: false,
          repoGroundedButGeneric: false,
          askedDespiteNoAsk: false,
          vagueNonCompletion: false,
        },
      };

  const text = reply.trim();
  const reasons = [...base.reasons];
  const blockingReasons: string[] = [];
  let severity = base.severity;

  const raise = (floor: number, reason: string, blocking = true) => {
    severity = Math.max(severity, floor);
    reasons.push(reason);
    if (blocking) blockingReasons.push(reason);
  };

  const unverifiedFacts = evidence.unverifiedFactCount > 0;
  const hedged = HEDGE_RE.test(text);
  HEDGE_RE.lastIndex = 0;
  const unhedgedUnverifiedFacts = unverifiedFacts && !hedged;
  if (unverifiedFacts) {
    raise(
      unhedgedUnverifiedFacts
        ? EVIDENCE_SEVERITY.unverifiedUnhedged
        : EVIDENCE_SEVERITY.unverifiedHedged,
      `fact-check ${evidence.unverifiedFactCount}/${evidence.totalFactCount} unverified` +
        (unhedgedUnverifiedFacts ? " (asserted without hedge)" : " (hedged)"),
    );
  }

  // Prefer the compiled ResponseContract ceiling when one exists. The older
  // shape ceiling remains the fallback for legacy callers that have no contract.
  const effectiveCeiling = contract?.hardMaxWords ?? evidence.lengthCeiling;
  const lengthRatio = effectiveCeiling > 0 ? evidence.wordCount / effectiveCeiling : 0;
  const lengthOverrun = lengthRatio > LENGTH_OVERRUN_RATIO;
  if (lengthOverrun) {
    raise(
      EVIDENCE_SEVERITY.lengthOverrun,
      `length ${evidence.wordCount} words = ${Math.round(lengthRatio * 100)}% of the ${effectiveCeiling} ceiling`,
    );
  }

  const ns = evidence.namedSources;
  const receiptsBlind = ns?.blind ?? false;
  let fabricatedNamedSource = false;
  let namedWithoutAnyTool = false;
  let unearnedConfidenceTag = false;

  if (ns && !receiptsBlind) {
    fabricatedNamedSource = ns.unreceipted.length > 0;
    namedWithoutAnyTool = ns.namedWithoutAnyTool;
    unearnedConfidenceTag = ns.unearnedConfidenceTags.length > 0;

    if (fabricatedNamedSource) {
      raise(
        EVIDENCE_SEVERITY.fabricatedNamedSource,
        `named ${ns.unreceipted.length} resource(s) with no tool receipt: ${ns.unreceipted
          .map((c) => c.name)
          .slice(0, 3)
          .join(", ")}`,
      );
    }
    if (namedWithoutAnyTool) {
      raise(
        EVIDENCE_SEVERITY.namedWithoutAnyTool,
        "named specific resources but no tool fired this turn",
      );
    }
    if (unearnedConfidenceTag) {
      raise(
        EVIDENCE_SEVERITY.unearnedTag,
        `model wrote ${ns.unearnedConfidenceTags.length} confidence tag(s) with no receipt`,
      );
    }
  } else if (receiptsBlind) {
    reasons.push("tool receipts unreadable this turn -- evidence checks suppressed");
  }

  const verdict: GateVerdict =
    blockingReasons.length > 0 && severity >= BLOCK_THRESHOLD
      ? "block"
      : severity >= REPAIR_THRESHOLD
        ? "repair"
        : "pass";

  return {
    ...base,
    severity,
    reasons,
    shouldRegen: severity >= REPAIR_THRESHOLD,
    verdict,
    blockingReasons,
    evidenceSignals: {
      unverifiedFacts,
      unhedgedUnverifiedFacts,
      lengthOverrun,
      lengthRatio,
      fabricatedNamedSource,
      namedWithoutAnyTool,
      unearnedConfidenceTag,
      receiptsBlind,
    },
  };
}
