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
 * 2026-08-18: the stub-reply signal honors the output critic's brevity
 * waiver — an explicitly ordered terse reply ("reply with just OK") is
 * obedience, not a stub offense. The badge ORs critic + gate verdicts,
 * so BOTH scorers must waive or the chip still fires.
 *
 * Heavier gates (fact-check against brain memory) live in fact-check.ts.
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
  // 2026-08-18 · same waiver as the output critic: when the operator
  // explicitly ordered a terse reply ("reply with just OK", "yes or
  // no"), an obedient stub is COMPLIANCE, not a quality failure. The
  // critic's waiver alone was not enough — the quality badge ORs
  // critic.shouldRegen with gate.shouldRegen, so this gate re-flagged
  // the exact reply the critic had just waived (live-verified on the
  // persisted verdict: critic overall=100 waived, gate severity=80).
  const brevityRequested = detectBrevityRequest(userText);
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
  if (isStubReply && turnSignal.intent !== "casual" && !brevityRequested) {
    severity = Math.max(severity, 80);
    reasons.push("stub reply on non-casual turn");
  } else if (isStubReply && brevityRequested) {
    // Waives ONLY the stub-shape signal — empty / ungrounded-IDK /
    // sub-question-miss / hedge-storm still fire below.
    reasons.push("brevity-requested · stub-reply waived (operator-constrained reply)");
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

// ── EVIDENCE GATE — 2026-09-10 ───────────────────────────────────────
/**
 * The gate above scores SHAPE. This one scores EVIDENCE, and it is the
 * one with teeth.
 *
 * Witnessed failure (adversarial audit, 2026-09-10): a reply shipped at
 * `severity 0` carrying `fact check: 1/5 unverified` and `words=525`
 * against a 300-word ceiling. Both numbers were computed correctly and
 * neither could reach the severity score, because:
 *
 *   1. `runReplyGate` has no fact-check parameter at all. `unverifiedCount`
 *      is computed in persist-assistant-turn.ts and written straight to
 *      the panel payload -- nothing reads it back.
 *   2. Length reaches the base gate only through `contract.length`, i.e.
 *      only when the operator explicitly asked for concise.
 *   3. The critic's own length tiers are `> ceiling * 1.4` -> score 60
 *      (warn) and `> ceiling * 1.8` -> score 30 (off). Only <= 30 counts
 *      as a critical axis. 525 words against a 300 ceiling is 175% --
 *      it missed the hard flag by 15 words, scored `100*.35 + 100*.25 +
 *      100*.20 + 60*.20` = 92, left `shouldRegen` false, and line 145's
 *      `if (critic.shouldRegen)` therefore contributed nothing.
 *
 * So the observed "sev 0" was not a mis-tuned threshold. It was three
 * signals with no wire to the scorer. This function is that wire.
 *
 * SEVERITY FLOOR, not a bump: an unverified factual claim is never 0.
 */

/** What downstream should DO, not merely what it should record. */
export type GateVerdict = "pass" | "repair" | "block";

/** Minimal shape of the named-source report (see chat/named-source-claims.ts). */
export interface NamedSourceEvidence {
  unreceipted: ReadonlyArray<{ name: string }>;
  unearnedConfidenceTags: ReadonlyArray<string>;
  namedWithoutAnyTool: boolean;
  /** Receipts could not be read. Flag, never block -- a blind instrument is not a pass. */
  blind: boolean;
}

export interface GateEvidence {
  /** countUnverified(factCheck(reply, brainContext)) */
  unverifiedFactCount: number;
  /** Total fact claims examined. 0 means the checker never ran. */
  totalFactCount: number;
  /** Word count of the reply as the critic measured it. */
  wordCount: number;
  /** The shape ceiling the critic compared against (SHAPE_LENGTH[shape].max). */
  lengthCeiling: number;
  namedSources?: NamedSourceEvidence;
}

export interface EvidenceGateDecision extends ContractGateDecision {
  verdict: GateVerdict;
  /** Only the reasons that justify a repair or a block, in precedence order. */
  blockingReasons: string[];
  evidenceSignals: {
    unverifiedFacts: boolean;
    unhedgedUnverifiedFacts: boolean;
    lengthOverrun: boolean;
    lengthRatio: number;
    fabricatedNamedSource: boolean;
    namedWithoutAnyTool: boolean;
    unearnedConfidenceTag: boolean;
    /** True when receipts were unreadable -- suppresses blocks by design. */
    receiptsBlind: boolean;
  };
}

/**
 * Severity floors. Chosen so every one of them clears the `>= 50` regen
 * line -- the whole defect was signals that scored below it.
 */
export const EVIDENCE_SEVERITY = {
  /** Unverified claim, hedged in-text. Honest uncertainty, still not clean. */
  unverifiedHedged: 55,
  /** Unverified claim asserted flat. */
  unverifiedUnhedged: 60,
  /** Over 1.5x the shape ceiling. */
  lengthOverrun: 55,
  /** A confidence tag the model had no standing to write. */
  unearnedTag: 65,
  /** Named a resource with no tool call anywhere in the turn. */
  namedWithoutAnyTool: 70,
  /** Named a specific resource that no receipt supports. The fabrication case. */
  fabricatedNamedSource: 75,
} as const;

/** Above this, the reply must not ship as written. */
export const BLOCK_THRESHOLD = 70;
/** Above this, the reply needs a repair pass (shorten / hedge / strip). */
export const REPAIR_THRESHOLD = 50;

/** Length ratio past which a reply is over-long enough to act on. */
export const LENGTH_OVERRUN_RATIO = 1.5;

/**
 * Evidence-aware gate. Wraps the contract gate; never lowers its
 * severity. Pure -- same inputs, same verdict.
 */
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

  // 1. Unverified factual claims. The audit's rule: never severity 0.
  //    A hedge in the reply lowers the floor but does not clear it --
  //    "I think X" about an invented X is still an invented X.
  const unverifiedFacts = evidence.unverifiedFactCount > 0;
  const hedged = HEDGE_RE.test(text);
  HEDGE_RE.lastIndex = 0; // global regex -- reset or the next call lies
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

  // 2. Length overrun the critic's warn tier cannot express.
  const lengthRatio =
    evidence.lengthCeiling > 0 ? evidence.wordCount / evidence.lengthCeiling : 0;
  const lengthOverrun = lengthRatio > LENGTH_OVERRUN_RATIO;
  if (lengthOverrun) {
    raise(
      EVIDENCE_SEVERITY.lengthOverrun,
      `length ${evidence.wordCount} words = ${Math.round(lengthRatio * 100)}% of the ${evidence.lengthCeiling} ceiling`,
    );
  }

  // 3. Named sources with no receipt. Blocks are suppressed when the
  //    receipt channel is blind -- an unreadable instrument is not
  //    evidence of innocence, but it is not evidence of guilt either.
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
