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
 *    tool resolved, removing a structured entity id no source emitted,
 *    and truncating to the response-contract ceiling are string operations.
 *
 * 2. EXACTLY ONE RE-GATE. A regenerate loop under an adversarial scorer
 *    is a reward-hacking machine with an unbounded latency tail.
 *
 * 3. THE FALLBACK IS A CONSTANT, NOT A GENERATION. A fallback that can
 *    itself fail is not a fallback.
 */

import type { EvidenceGateDecision, GateEvidence, GateVerdict } from "@/lib/ai/reply-gate";
import { runEvidenceGate } from "@/lib/ai/reply-gate";
import { buildResponseContract } from "@/lib/ai/response-contract";
import { responseBudgetFor } from "./turn-control-plane";
import type { NamedSourceReport } from "./named-source-claims";
import { stripUnearnedConfidenceTags, normalizeName } from "./named-source-claims";
import {
  removeUnsupportedEntityClaims,
  type EntityClaimReport,
} from "./entity-claim-provenance";

const GUTTED_MIN_WORDS = 6;
const GUTTED_LOSS_RATIO = 0.6;

export interface RepairResult {
  text: string;
  applied: string[];
  gutted: boolean;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function lossGutted(before: string, after: string): boolean {
  const beforeWords = wordCount(before);
  const afterWords = wordCount(after);
  return (
    afterWords < GUTTED_MIN_WORDS ||
    (beforeWords > 0 && (beforeWords - afterWords) / beforeWords > GUTTED_LOSS_RATIO)
  );
}

const LIST_ITEM_RE = /^\s*(?:\d+[.)]|[-*•])\s+/;

export function removeUnreceiptedClaims(text: string, names: readonly string[]): RepairResult {
  if (names.length === 0) return { text, applied: [], gutted: false };

  const keys = names.map(normalizeName).filter(Boolean);
  const carriesName = (s: string) => {
    const n = normalizeName(s);
    return keys.some((k) => n.includes(k));
  };

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

  return { text: rebuilt, applied, gutted: lossGutted(text, rebuilt) };
}

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

  if ((namedSources?.unsupportedEntityClaims?.length ?? 0) > 0) {
    const before = current;
    const entityReport: EntityClaimReport = {
      claims: namedSources?.entityClaims ?? [],
      unsupported: namedSources?.unsupportedEntityClaims ?? [],
    };
    const r = removeUnsupportedEntityClaims(current, entityReport);
    current = r.text;
    if (r.removed > 0) {
      applied.push(
        `dropped ${r.removed} sentence(s) containing structured entity ids with no provenance`,
      );
    }
    gutted = gutted || lossGutted(before, current);
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
  ceilingWords: number;
  reassess: (repaired: string) => { evidence: GateEvidence; namedSources: NamedSourceReport | null };
}

export function enforceGate(input: GatedReplyInput): GatedReplyOutcome {
  const { draft, userText, critic, turnSignal, contract, evidence } = input;
  const actions: string[] = [];

  const effectiveContract = contract ?? buildResponseContract(userText, turnSignal);
  const effectiveCeiling = responseBudgetFor(effectiveContract).hardMaxWords;
  const contractOverrun = effectiveCeiling > 0 && wordCount(draft) > effectiveCeiling;
  const unsupportedEntityCount = input.namedSources?.unsupportedEntityClaims?.length ?? 0;

  const initial = runEvidenceGate(
    draft,
    userText,
    critic,
    turnSignal,
    effectiveContract,
    evidence,
  );

  if (initial.verdict === "pass" && !contractOverrun && unsupportedEntityCount === 0) {
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
  if (unsupportedEntityCount > 0) {
    actions.push(
      `structured entity provenance violation (${unsupportedEntityCount} unsupported id${unsupportedEntityCount === 1 ? "" : "s"})`,
    );
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
  const remainingUnsupportedEntities = re.namedSources?.unsupportedEntityClaims?.length ?? 0;

  if (afterRepair.verdict === "block" || remainingUnsupportedEntities > 0) {
    if (remainingUnsupportedEntities > 0) {
      actions.push(
        `structured entity provenance still failing after one repair (${remainingUnsupportedEntities})`,
      );
    }
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
