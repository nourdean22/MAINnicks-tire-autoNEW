/**
 * GATE ENFORCEMENT tests -- 2026-09-10.
 *
 * `runEvidenceGate` decides; this is the consumer that acts. The whole
 * 2026-09-10 defect was a verdict nothing read, so the assertions here
 * are about BEHAVIOUR CHANGE -- did the shipped text actually differ --
 * not about whether a verdict was computed.
 */
import { describe, it, expect } from "vitest";
import {
  enforceGate,
  repairDeterministically,
  removeUnreceiptedClaims,
  truncateToCeiling,
  UNVERIFIED_FALLBACK,
} from "@/lib/ai/chat/gate-enforcement";
import { checkNamedSources, type NamedSourceReport } from "@/lib/ai/chat/named-source-claims";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { buildResponseContract } from "@/lib/ai/response-contract";
import type { GateEvidence } from "@/lib/ai/reply-gate";

const ASK = "give me the most exclusive and clever resources on this";

function evidence(over: Partial<GateEvidence> = {}): GateEvidence {
  return {
    unverifiedFactCount: 0,
    totalFactCount: 3,
    wordCount: 60,
    lengthCeiling: 300,
    namedSources: {
      unreceipted: [],
      unearnedConfidenceTags: [],
      namedWithoutAnyTool: false,
      blind: false,
    },
    ...over,
  };
}

/** Build the real report for a draft with no tool activity. */
function reportFor(text: string, evidenceText = "", tools: { name: string }[] = []) {
  return checkNamedSources(text, {
    toolCalls: tools,
    evidenceText,
    receiptsAvailable: true,
    userText: ASK,
  });
}

function run(
  draft: string,
  ns: NamedSourceReport,
  ev: GateEvidence,
  ceiling = 300,
  receipts: { evidenceText: string; tools: { name: string }[] } = { evidenceText: "", tools: [] },
) {
  return enforceGate({
    draft,
    userText: ASK,
    critic: null,
    turnSignal: classifyTurn(ASK),
    contract: null,
    evidence: ev,
    namedSources: ns,
    ceilingWords: ceiling,
    reassess: (repaired) => {
      const r = reportFor(repaired, receipts.evidenceText, receipts.tools);
      return {
        evidence: { ...ev, wordCount: repaired.trim().split(/\s+/).length, namedSources: r },
        namedSources: r,
      };
    },
  });
}

describe("THE STOIC STRATEGY TURN -- end to end", () => {
  const DRAFT = [
    "Here are four worth your time:",
    "- **Daily Stoic** -- the accessible entry point.",
    "- **Stoic Strategy** -- goes deep on applied discipline.",
    "- **The Machiavellian Empire** -- covers the power material.",
    "- **Einzelganger** -- the philosophical end of it.",
  ].join("\n");

  const RECEIPTS = {
    evidenceText:
      "results: Daily Stoic youtube.com/@dailystoic ; Einzelganger youtube.com/@einzelganger",
    tools: [{ name: "web_search" }],
  };

  it("removes the two channels no receipt supports and keeps the two that have one", () => {
    const ns = reportFor(DRAFT, RECEIPTS.evidenceText, RECEIPTS.tools);
    const out = run(DRAFT, ns, evidence({ namedSources: ns }), 300, RECEIPTS);

    expect(out.text).toMatch(/Daily Stoic/);
    expect(out.text).toMatch(/Einzelganger/);
    expect(out.text).not.toMatch(/Stoic Strategy/);
    expect(out.text).not.toMatch(/Machiavellian Empire/);
    expect(out.usedFallback).toBe(false);
  });

  it("the shipped text actually differs from the draft -- this is a gate, not a log", () => {
    const ns = reportFor(DRAFT, RECEIPTS.evidenceText, RECEIPTS.tools);
    const out = run(DRAFT, ns, evidence({ namedSources: ns }), 300, RECEIPTS);
    expect(out.text).not.toBe(DRAFT);
    expect(out.actions.join(" ")).toMatch(/dropped list item/i);
  });

  it("when NO tool fired, every name is unreceipted and the fallback ships", () => {
    const ns = reportFor(DRAFT);
    const out = run(DRAFT, ns, evidence({ namedSources: ns }));
    expect(out.usedFallback).toBe(true);
    expect(out.text).toBe(UNVERIFIED_FALLBACK);
    expect(out.text).toMatch(/didn't actually run a search/i);
    expect(out.verdict).toBe("block");
  });

  it("CONTROL - a fully receipted list ships byte-identical", () => {
    const all = { evidenceText: "Daily Stoic ; Stoic Strategy ; The Machiavellian Empire ; Einzelganger", tools: [{ name: "web_search" }] };
    const ns = reportFor(DRAFT, all.evidenceText, all.tools);
    const out = run(DRAFT, ns, evidence({ namedSources: ns }), 300, all);
    expect(out.verdict).toBe("pass");
    expect(out.text).toBe(DRAFT);
    expect(out.actions).toHaveLength(0);
  });
});

describe("deterministic repair primitives", () => {
  it("drops only the offending list item", () => {
    const t = "- Real One is good.\n- Fake Two is invented.\n- Real Three is fine.";
    const r = removeUnreceiptedClaims(t, ["Fake Two"]);
    expect(r.text).toMatch(/Real One/);
    expect(r.text).toMatch(/Real Three/);
    expect(r.text).not.toMatch(/Fake Two/);
    expect(r.gutted).toBe(false);
  });

  it("drops an offending sentence from prose without touching its neighbours", () => {
    const t = "The pattern is consistent. Fake Two covers this well. Either way the move is the same.";
    const r = removeUnreceiptedClaims(t, ["Fake Two"]);
    expect(r.text).toMatch(/pattern is consistent/);
    expect(r.text).toMatch(/move is the same/);
    expect(r.text).not.toMatch(/Fake Two/);
  });

  it("flags `gutted` when repair removes the answer rather than the defect", () => {
    const r = removeUnreceiptedClaims("- Fake Two is the one.", ["Fake Two"]);
    expect(r.gutted).toBe(true);
  });

  it("truncates at a sentence boundary, never mid-clause", () => {
    const t = "One two three four five. Six seven eight nine ten. Eleven twelve thirteen.";
    const r = truncateToCeiling(t, 7);
    expect(r.text).toBe("One two three four five.");
    expect(r.text.endsWith(".")).toBe(true);
  });

  it("CONTROL - text already under the ceiling is untouched", () => {
    const t = "Short and already fine.";
    expect(truncateToCeiling(t, 300).text).toBe(t);
    expect(truncateToCeiling(t, 300).applied).toHaveLength(0);
  });
});

describe("visible-answer contract is real enforcement on buffered replies", () => {
  const LONG = Array.from({ length: 30 }, (_, i) => `Sentence ${i} has four useful words.`).join(" ");

  it("normal contract truncates over-80 text even when the old 300-word evidence ceiling passes", () => {
    const ns = reportFor(LONG);
    const wc = LONG.trim().split(/\s+/).length;
    const contract = buildResponseContract(ASK, classifyTurn(ASK));
    const ev = evidence({ wordCount: wc, lengthCeiling: 300, namedSources: ns });

    const out = enforceGate({
      draft: LONG,
      userText: ASK,
      critic: null,
      turnSignal: classifyTurn(ASK),
      contract,
      evidence: ev,
      namedSources: ns,
      ceilingWords: 300,
      reassess: (repaired) => ({
        evidence: { ...ev, wordCount: repaired.trim().split(/\s+/).length },
        namedSources: ns,
      }),
    });

    const outWords = out.text.trim().split(/\s+/).length;
    expect(wc).toBeGreaterThan(80);
    expect(outWords).toBeLessThanOrEqual(80);
    expect(out.actions.join(" ")).toMatch(/contract overrun/i);
    expect(out.actions.join(" ")).toMatch(/80-word ceiling/i);
    expect(out.usedFallback).toBe(false);
  });

  it("explicit detailed contract may exceed 80 instead of being silently crushed", () => {
    const ns = reportFor(LONG);
    const contract = buildResponseContract("give me a detailed exhaustive answer", classifyTurn("give me a detailed exhaustive answer"));
    const ev = evidence({ wordCount: LONG.trim().split(/\s+/).length, lengthCeiling: 300, namedSources: ns });
    const out = enforceGate({
      draft: LONG,
      userText: "give me a detailed exhaustive answer",
      critic: null,
      turnSignal: classifyTurn("give me a detailed exhaustive answer"),
      contract,
      evidence: ev,
      namedSources: ns,
      ceilingWords: 300,
      reassess: () => ({ evidence: ev, namedSources: ns }),
    });
    expect(out.text).toBe(LONG);
    expect(out.actions).toHaveLength(0);
  });
});

describe("the legacy shape ceiling still works when no response contract exists", () => {
  const LONG = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says a thing.`).join(" ");

  it("length overrun triggers an actual truncation", () => {
    const ns = reportFor(LONG);
    const wc = LONG.trim().split(/\s+/).length;
    const out = run(LONG, ns, evidence({ wordCount: wc, lengthCeiling: 100, namedSources: ns }), 100);
    const outWords = out.text.trim().split(/\s+/).length;
    expect(outWords).toBeLessThan(wc);
    expect(outWords).toBeLessThanOrEqual(100);
    expect(out.actions.join(" ")).toMatch(/truncated/i);
  });
});

describe("exactly one repair pass", () => {
  it("never re-gates more than once, and falls back rather than looping", () => {
    const draft =
      "- The Fake One channel is great.\n- The Fake Two podcast is better.\n- Plus a closing paragraph of ordinary prose that carries the actual answer and stands perfectly well on its own without naming anything at all.";
    const ns = reportFor(draft);
    let reassessCalls = 0;
    const out = enforceGate({
      draft,
      userText: ASK,
      critic: null,
      turnSignal: classifyTurn(ASK),
      contract: null,
      evidence: evidence({ namedSources: ns }),
      namedSources: ns,
      ceilingWords: 300,
      reassess: (repaired) => {
        reassessCalls++;
        const r = checkNamedSources(repaired, {
          toolCalls: [],
          evidenceText: "",
          receiptsAvailable: true,
        });
        const forced: NamedSourceReport = {
          ...r,
          unreceipted: [{ name: "Fake One", kind: "listed", snippet: "", titleMarked: true }],
          namedWithoutAnyTool: true,
        };
        return {
          evidence: { ...evidence({ namedSources: forced }), wordCount: 30 },
          namedSources: forced,
        };
      },
    });
    expect(reassessCalls).toBe(1);
    expect(out.usedFallback).toBe(true);
    expect(out.text).toBe(UNVERIFIED_FALLBACK);
  });
});

describe("repair leaves no internal notation in shipped text", () => {
  it("stripped tags do not leave a trace in the reply", () => {
    const draft = "illacertus [confirmed] is the pick, and the reasoning holds up across every episode I looked at.";
    const ns = reportFor(draft, "illacertus youtube.com/Illacertus", [{ name: "web_search" }]);
    const r = repairDeterministically(
      draft,
      { evidenceSignals: { lengthOverrun: false } } as never,
      ns,
      300,
    );
    expect(r.text).toBe(draft);
    expect(r.applied).toHaveLength(0);
  });

  it("an unearned tag is removed cleanly, leaving readable prose", () => {
    const draft = "illacertus [confirmed] is the pick.";
    const ns = reportFor(draft);
    const r = repairDeterministically(
      draft,
      { evidenceSignals: { lengthOverrun: false } } as never,
      ns,
      300,
    );
    expect(r.text).not.toMatch(/\[confirmed\]/);
    expect(r.text).toMatch(/illacertus/);
    expect(r.text).not.toMatch(/ {2,}/);
  });
});
