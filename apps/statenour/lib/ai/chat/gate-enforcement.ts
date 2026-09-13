/**
 * GATE ENFORCEMENT -- 2026-09-10.
 *
 * `runEvidenceGate()` decides pass/repair/block. This module is what
 * ACTS on that decision -- the consumer whose absence was the entire
 * 2026-09-10 defect. A verdict nothing reads is a log line.
 *
 * THREE RULES, each guarding a failure this design could otherwise
 * introduce:
 *
 * 1. DETERMINISTIC REPAIR BEFORE GENERATIVE REPAIR. Stripping an
 *    unearned `[confirmed]`, dropping a list item naming a channel no
 *    tool resolved, and truncating to the response-contract ceiling are
 *    string operations. Reaching for a model call to do them would add
 *    seconds and a fresh chance to hallucinate, to fix a hallucination.
 *
 * 2. EXACTLY ONE RE-GATE. A regenerate loop under an adversarial scorer
 *    is a reward-hacking machine with an unbounded latency tail: the
 *    model learns the shape that satisfies the gate rather than the
 *    shape that is true. One pass, then ship or fall back.
 *
 * 3. THE FALLBACK IS A CONSTANT, NOT A GENERATION. A fallback that can
 *    itself fail is not a fallback. It is deliberately an offer to do
 *    the lookup, because the honest answer to "no receipt" is "I did not
 *    check -- want me to?", which is the line the audit asked for.
 */

import type { EvidenceGateDecision, GateEvidence, GateVerdict } from "@/lib/ai/reply-gate";
import { runEvidenceGate } from "@/lib/ai/reply-gate";
import { buildResponseContract } from "@/lib/ai/response-contract";
import { responseBudgetFor } from "./turn-control-plane";
import type { NamedSourceReport } from "./named-source-claims";
import { stripUnearnedConfidenceTags } from "./named-source-claims";
import { normalizeName } from "./named-source-claims";

/**
 * "Gutted" must mean DESTROYED, not merely SHORT.
 *
 * The loss RATIO is the real signal: dropping one of three
 * recommendations leaves a terse but valid answer, while dropping all
 * three leaves a preamble pointing at nothing. An absolute word floor
 * on its own conflates those two, and set high it would send perfectly
 * good short replies to the fallback -- which would make the gate a
 * worse product than the bug it fixes.
 */
const GUTTED_MIN_WORDS = 6;
/** Losing more than this share of the reply means the repair destroyed it. */
const GUTTED_LOSS_RATIO = 0.6;

export interface RepairResult {
  text: string;
  /** Human-readable list of what was done, for the evidence panel. */
  applied: string[];
  /** True when repair removed so much that the reply no longer answers. */
  gutted: boolean;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const LIST_ITEM_RE = /^\s*(?:\d+[.)]|[-*•])\s+/;

/**
 * Drop the lines and sentences that carry a name no receipt supports.
 *
 * Line-level first (a recommendation list is the shape this failure
 * arrives in), then sentence-level for prose. Anything that survives is
 * text whose named entities were all grounded.
 */
export function removeUnreceiptedClaims(text: string, names: readonly string[]): RepairResult {
  if (names.length === 0) return { text, applied: [], gutted: false };

  const keys = names.map(normalizeName).filter(Boolean);
  const carriesName = (s: string) => {
    const n = normalizeName(s);
    return keys.some((k) => n.includes(k));
  };

  const before = wordCount(text);
  const applied: string[] = [];

  const keptLines = text.split("\n").filter((line) => {
    if (LIST_ITEM_RE.test(line) && carriesName(line)) {
      applied.push("dropped list item naming an unverified resource");
      return false;
    }
    return true;
  });

  const rebuilt = keptLines
    .map((line) => {
      if (LIST_ITEM_RE.test(line) || !carriesName(line)) return line;
      const sentences = line.split(/(?<=[.!?])\s+/);
      const kept = sentences.filter((s) => {
        if (carriesName(s)) {
          applied.push("dropped a sentence naming an unverified resource");
          return false;
        }
        return true;
      });
      return kept.join(" ");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const after = wordCount(rebuilt);
  const gutted =
    after < GUTTED_MIN_WORDS || (before > 0 && (before - after) / before > GUTTED_LOSS_RATIO);

  return { text: rebuilt, applied, gutted };
}

/**
 * Truncate to the visible-answer ceiling at a sentence boundary.
 *
 * Deliberately cuts at a sentence, never mid-clause: a reply chopped
 * mid-sentence reads as a crash, and the audit's whole subject is
 * output that betrays its own machinery.
 */
export function truncateToCeiling(text: string, ceilingWords: number): RepairResult {
  if (ceilingWords <= 0 || wordCount(text) <= ceilingWords) {
    return { text, applied: [], gutted: false };
  }
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  let running = 0;
  for (const s of sentences) {
    const w = wordCount(s);
    if (running + w > ceilingWords && kept.length > 0) break;
    kept.push(s);
    running += w;
  }
  const out = kept.join(" ").trim();
  return {
    text: out,
    applied: [`truncated to the ${ceilingWords}-word ceiling at a sentence boundary`],
    gutted: wordCount(out) < GUTTED_MIN_WORDS,
  };
}

/**
 * The deterministic repair pass. Order matters: strip tags before
 * removing claims (a stripped tag may be all that was wrong with an
 * otherwise-grounded line), and truncate last so the count reflects
 * what actually survived.
 *
 * The ceiling is an INPUT CONTRACT, not merely an evidence-gate signal.
 * If text is over the ceiling, truncate even when the older evidence scorer
 * calls the reply a pass. This prevents the historical 80-vs-300 split brain.
 */
export function repairDeterministically(
  text: string,
  gate: EvidenceGateDecision,
  namedSources: NamedSourceReport | null,
  ceilingWords: number,
): RepairResult {
  let current = text;
  const applied: string[] = [];
  let gutted = false;
  void gate;

  if (namedSources && namedSources.unearnedConfidenceTags.length > 0) {
    current = stripUnearnedConfidenceTags(current, namedSources);
    applied.push(
      `stripped ${namedSources.unearnedConfidenceTags.length} confidence tag(s) with no tool receipt`,
    );
  }

  if (namedSources && namedSources.unreceipted.length > 0) {
    const r = removeUnreceiptedClaims(current, namedSources.unreceipted.map((c) => c.name));
    current = r.text;
    applied.push(...r.applied);
    gutted = gutted || r.gutted;
  }

  if (ceilingWords > 0) {
    const r = truncateToCeiling(current, ceilingWords);
    current = r.text;
    applied.push(...r.applied);
    gutted = gutted || r.gutted;
  }

  return { text: current, applied, gutted };
}

export const UNVERIFIED_FALLBACK =
  "I don't have a verified source for that -- I didn't actually run a search this turn, so anything specific I named would have been from memory rather than a lookup. Want me to search it properly?";

export interface GatedReplyOutcome {
  text: string;
  verdict: GateVerdict;
  initial: EvidenceGateDecision;
  afterRepair: EvidenceGateDecision | null;
  actions: string[];
  usedFallback: boolean;
}

export interface GatedReplyInput {
  draft: string;
  userText: string;
  critic: Parameters<typeof runEvidenceGate>[2];
  turnSignal: Parameters<typeof runEvidenceGate>[3];
  contract: Parameters<typeof runEvidenceGate>[4];
  evidence: GateEvidence;
  namedSources: NamedSourceReport | null;
  /**
   * Legacy output-shape ceiling. Retained for telemetry/backward compatibility.
   * A missing ResponseContract is reconstructed at this seam rather than
   * silently falling back to the old 300-word prose truth.
   */
  ceilingWords: number;
  reassess: (repaired: string) => { evidence: GateEvidence; namedSources: NamedSourceReport | null };
}

/**
 * Run the gate, enforce it, and return what should ship.
 *
 * Pure with respect to IO -- no model calls, no DB. That is what makes
 * the whole enforcement path unit-testable, and it is why deterministic
 * repair was chosen over a regenerate-first design.
 */
export function enforceGate(input: GatedReplyInput): GatedReplyOutcome {
  const { draft, userText, critic, turnSignal, contract, evidence } = input;
  const actions: string[] = [];

  // Some buffered callers historically passed `contract: null`. Letting null
  // resurrect the legacy 300-word prose ceiling would recreate two competing
  // constitutions. The contract builder is pure/deterministic, so reconstruct
  // it from the same turn inputs when the caller omitted it.
  const effectiveContract = contract ?? buildResponseContract(userText, turnSignal);
  const effectiveCeiling = responseBudgetFor(effectiveContract).hardMaxWords;
  const contractOverrun = effectiveCeiling > 0 && wordCount(draft) > effectiveCeiling;

  const initial = runEvidenceGate(
    draft,
    userText,
    critic,
    turnSignal,
    effectiveContract,
    evidence,
  );

  if (initial.verdict === "pass" && !contractOverrun) {
    return {
      text: draft,
      verdict: "pass",
      initial,
      afterRepair: null,
      actions,
      usedFallback: false,
    };
  }

  if (initial.verdict !== "pass") {
    actions.push(
      `gate ${initial.verdict} (severity ${initial.severity}): ${initial.blockingReasons.join("; ")}`,
    );
  }
  if (contractOverrun) {
    actions.push(`visible-answer contract overrun (${wordCount(draft)} > ${effectiveCeiling} words)`);
  }

  const repair = repairDeterministically(draft, initial, input.namedSources, effectiveCeiling);
  actions.push(...repair.applied);

  if (repair.gutted) {
    actions.push("repair would have gutted the reply -- shipped the deterministic fallback");
    return {
      text: UNVERIFIED_FALLBACK,
      verdict: "block",
      initial,
      afterRepair: null,
      actions,
      usedFallback: true,
    };
  }

  const re = input.reassess(repair.text);
  const afterRepair = runEvidenceGate(
    repair.text,
    userText,
    critic,
    turnSignal,
    effectiveContract,
    re.evidence,
  );

  if (afterRepair.verdict === "block") {
    actions.push("still blocking after one repair -- shipped the deterministic fallback");
    return {
      text: UNVERIFIED_FALLBACK,
      verdict: "block",
      initial,
      afterRepair,
      actions,
      usedFallback: true,
    };
  }

  actions.push(`repaired to ${afterRepair.verdict} (severity ${afterRepair.severity})`);
  return {
    text: repair.text,
    verdict: afterRepair.verdict,
    initial,
    afterRepair,
    actions,
    usedFallback: false,
  };
}
