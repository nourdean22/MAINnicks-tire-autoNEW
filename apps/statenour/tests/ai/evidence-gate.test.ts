/**
 * EVIDENCE GATE tests -- 2026-09-10.
 *
 * The centerpiece is `AUDIT REPLAY`: the exact turn from the 2026-09-10
 * adversarial audit, replayed with its real numbers (525 words, a 300
 * ceiling, 1 of 5 facts unverified). Before this change that turn scored
 * `severity 0 / passed`. If it ever scores 0 again, this file fails.
 *
 * Canary discipline (AGENTS.md "Ship the canary, not just the control"):
 * every blocking rule here is asserted in BOTH directions -- the
 * violation fires AND a clean control still passes. A gate that blocks
 * everything is as broken as one that blocks nothing, and only the pair
 * can tell them apart.
 */
import { describe, it, expect } from "vitest";
import {
  runEvidenceGate,
  runReplyGate,
  EVIDENCE_SEVERITY,
  BLOCK_THRESHOLD,
  REPAIR_THRESHOLD,
  type GateEvidence,
} from "@/lib/ai/reply-gate";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { shapeCeiling } from "@/lib/ai/chat/output-guardian";
import {
  checkNamedSources,
  detectNamedSources,
  stripUnearnedConfidenceTags,
} from "@/lib/ai/chat/named-source-claims";

/** Clean evidence: nothing wrong, nothing blind. The control. */
function cleanEvidence(overrides: Partial<GateEvidence> = {}): GateEvidence {
  return {
    unverifiedFactCount: 0,
    totalFactCount: 5,
    wordCount: 120,
    lengthCeiling: 300,
    namedSources: {
      unreceipted: [],
      unearnedConfidenceTags: [],
      namedWithoutAnyTool: false,
      blind: false,
    },
    ...overrides,
  };
}

function run(reply: string, userText: string, evidence: GateEvidence) {
  return runEvidenceGate(reply, userText, null, classifyTurn(userText), null, evidence);
}

const ASK = "give me the most exclusive and clever resources on this";
const PLAIN_REPLY =
  "Here is the shape of it. The pattern you are describing shows up in three places, " +
  "and the fix in each case is the same one: measure before you treat.";

describe("AUDIT REPLAY -- 2026-09-10 · the turn that shipped at severity 0", () => {
  // 525 words is 175% of the 300-word prose ceiling. The critic's hard
  // tier is 180% (540), so this reply missed it by 15 words, scored 92,
  // left shouldRegen false, and reached the old gate as nothing at all.
  const REPLY_525 = Array.from({ length: 525 }, (_, i) => `word${i}`).join(" ");
  const auditEvidence = cleanEvidence({
    unverifiedFactCount: 1,
    totalFactCount: 5,
    wordCount: 525,
    lengthCeiling: 300,
  });

  it("no longer scores severity 0", () => {
    const g = run(REPLY_525, ASK, auditEvidence);
    expect(g.severity).toBeGreaterThan(0);
  });

  it("does not report `pass`", () => {
    const g = run(REPLY_525, ASK, auditEvidence);
    expect(g.verdict).not.toBe("pass");
    expect(g.shouldRegen).toBe(true);
  });

  // POSITIVE CONTROL. A new function cannot regress against code that
  // never called it, so a green suite above proves nothing on its own.
  // This asserts the OLD path still scores this exact reply at 0 --
  // i.e. that the defect was real, and that the evidence wire (not a
  // re-tuned constant) is what closed it. If this ever starts failing,
  // the base gate changed underneath and the replay above is measuring
  // something other than the bug it was written for.
  it("POSITIVE CONTROL · the shape-only gate still scores this turn 0", () => {
    const shapeOnly = runReplyGate(REPLY_525, ASK, null, classifyTurn(ASK));
    expect(shapeOnly.severity).toBe(0);
    expect(shapeOnly.shouldRegen).toBe(false);
  });

  it("names both original violations, not just one", () => {
    const g = run(REPLY_525, ASK, auditEvidence);
    expect(g.evidenceSignals.unverifiedFacts).toBe(true);
    expect(g.evidenceSignals.lengthOverrun).toBe(true);
    expect(g.evidenceSignals.lengthRatio).toBeCloseTo(1.75, 2);
    expect(g.blockingReasons.join(" ")).toMatch(/unverified/);
    expect(g.blockingReasons.join(" ")).toMatch(/ceiling/);
  });
});

describe("fact-check severity floor -- a failure is never 0", () => {
  it("unverified + unhedged raises to the unhedged floor", () => {
    const g = run(PLAIN_REPLY, ASK, cleanEvidence({ unverifiedFactCount: 1 }));
    expect(g.severity).toBeGreaterThanOrEqual(EVIDENCE_SEVERITY.unverifiedUnhedged);
    expect(g.evidenceSignals.unhedgedUnverifiedFacts).toBe(true);
  });

  it("unverified BUT hedged still clears the regen line -- a hedge is a discount, not a pardon", () => {
    const g = run(
      "I think this is roughly right, though it might be off.",
      ASK,
      cleanEvidence({ unverifiedFactCount: 1 }),
    );
    expect(g.evidenceSignals.unhedgedUnverifiedFacts).toBe(false);
    expect(g.severity).toBeGreaterThanOrEqual(EVIDENCE_SEVERITY.unverifiedHedged);
    expect(g.severity).toBeGreaterThanOrEqual(REPAIR_THRESHOLD);
  });

  // CONTROL: the same reply with everything verified must stay clean, or
  // the floor above is just a constant that fires on every turn.
  it("CONTROL · fully verified facts leave the gate clean", () => {
    const g = run(PLAIN_REPLY, ASK, cleanEvidence());
    expect(g.evidenceSignals.unverifiedFacts).toBe(false);
    expect(g.verdict).toBe("pass");
    expect(g.severity).toBe(0);
  });
});

describe("length overrun", () => {
  it("fires past 1.5x the ceiling", () => {
    const g = run(PLAIN_REPLY, ASK, cleanEvidence({ wordCount: 460, lengthCeiling: 300 }));
    expect(g.evidenceSignals.lengthOverrun).toBe(true);
    expect(g.severity).toBeGreaterThanOrEqual(EVIDENCE_SEVERITY.lengthOverrun);
  });

  // CONTROL: 1.4x is the critic's own warn tier and is deliberately NOT
  // a gate offense -- otherwise every slightly-long reply blocks.
  it("CONTROL · 1.4x the ceiling does not fire", () => {
    const g = run(PLAIN_REPLY, ASK, cleanEvidence({ wordCount: 420, lengthCeiling: 300 }));
    expect(g.evidenceSignals.lengthOverrun).toBe(false);
    expect(g.verdict).toBe("pass");
  });
});

describe("named sources without receipts -- the Stoic Strategy case", () => {
  const FABRICATED =
    "Two worth your time: the Stoic Strategy channel goes deep on applied discipline, " +
    "and The Machiavellian Empire channel covers the power material.";

  it("detects a resource named with no tool receipt", () => {
    const report = checkNamedSources(FABRICATED, {
      toolCalls: [],
      evidenceText: "",
      receiptsAvailable: true,
      userText: ASK,
    });
    expect(report.claims.length).toBeGreaterThanOrEqual(2);
    expect(report.unreceipted.length).toBeGreaterThanOrEqual(2);
    expect(report.namedWithoutAnyTool).toBe(true);
  });

  it("BLOCKS the turn, not merely flags it", () => {
    const report = checkNamedSources(FABRICATED, {
      toolCalls: [],
      evidenceText: "",
      receiptsAvailable: true,
      userText: ASK,
    });
    const g = run(FABRICATED, ASK, cleanEvidence({ namedSources: report }));
    expect(g.severity).toBeGreaterThanOrEqual(BLOCK_THRESHOLD);
    expect(g.verdict).toBe("block");
  });

  // CONTROL: the same shape of reply, but the names came back from a
  // real search. This must ship. Without this assertion a permanently
  // blocking gate would score green.
  it("CONTROL · the same names WITH a search receipt pass clean", () => {
    const report = checkNamedSources(FABRICATED, {
      toolCalls: [{ name: "web_search" }],
      evidenceText:
        "results: Stoic Strategy - youtube.com/@stoicstrategy ; The Machiavellian Empire - youtube.com/@machiavellianempire",
      receiptsAvailable: true,
      userText: ASK,
    });
    expect(report.unreceipted).toHaveLength(0);
    const g = run(FABRICATED, ASK, cleanEvidence({ namedSources: report }));
    expect(g.verdict).toBe("pass");
  });

  it("CONTROL · a name the OPERATOR introduced is not a fabrication", () => {
    const report = checkNamedSources("The Daily Stoic podcast is the obvious one.", {
      toolCalls: [],
      evidenceText: "",
      receiptsAvailable: true,
      userText: "what do you think of the Daily Stoic podcast?",
    });
    expect(report.unreceipted).toHaveLength(0);
  });

  // EMPTY vs ERROR: an unreadable receipt channel is not a clean bill of
  // health, but it must not block either -- a blind instrument that
  // convicts is worse than one that abstains.
  it("blind receipts suppress the block and say so", () => {
    const report = checkNamedSources(FABRICATED, {
      toolCalls: [],
      evidenceText: "",
      receiptsAvailable: false,
    });
    expect(report.unreceipted).toHaveLength(0);
    expect(report.blind).toBe(true);
    const g = run(FABRICATED, ASK, cleanEvidence({ namedSources: report }));
    expect(g.verdict).not.toBe("block");
    expect(g.evidenceSignals.receiptsBlind).toBe(true);
    expect(g.reasons.join(" ")).toMatch(/receipts unreadable/);
  });
});

describe("confidence tags the model was not entitled to write", () => {
  const TAGGED = "illacertus [confirmed] and EmpowerMen [confirmed] are the picks.";

  it("flags a [confirmed] written with no tool call behind it", () => {
    const report = checkNamedSources(TAGGED, {
      toolCalls: [],
      evidenceText: "",
      receiptsAvailable: true,
    });
    expect(report.unearnedConfidenceTags.length).toBe(2);
    const g = run(TAGGED, ASK, cleanEvidence({ namedSources: report }));
    expect(g.evidenceSignals.unearnedConfidenceTag).toBe(true);
    expect(g.severity).toBeGreaterThanOrEqual(EVIDENCE_SEVERITY.unearnedTag);
  });

  it("strips the unearned tags from user-visible text", () => {
    const report = checkNamedSources(TAGGED, {
      toolCalls: [],
      evidenceText: "",
      receiptsAvailable: true,
    });
    const stripped = stripUnearnedConfidenceTags(TAGGED, report);
    expect(stripped).not.toMatch(/\[confirmed\]/i);
    expect(stripped).toMatch(/illacertus/);
  });

  // CONTROL: a tag backed by a real search survives untouched.
  it("CONTROL · a tag with a real receipt is earned and is not stripped", () => {
    const report = checkNamedSources(TAGGED, {
      toolCalls: [{ name: "web_search" }],
      evidenceText: "illacertus youtube.com/Illacertus ; EmpowerMen youtube channel",
      receiptsAvailable: true,
    });
    expect(report.unearnedConfidenceTags).toHaveLength(0);
    expect(stripUnearnedConfidenceTags(TAGGED, report)).toBe(TAGGED);
  });
});

describe("false-positive floor -- the gate must not block ordinary speech", () => {
  // These are the replies that would make a blocking gate unusable. Each
  // is prose a chief-of-staff actually writes. None may block.
  const ORDINARY = [
    "You said this on Monday too and it did not start. What is different this time?",
    "Short answer: the websocket drops when iOS suspends the tab. Reconnect on visibilitychange.",
    "Go run. You already know the answer to this one.",
    "That is roughly a 40mg equivalent -- an estimate, not a lab value. Confirm with your prescriber.",
    "I checked the records and there is no entry for that week.",
  ];

  for (const reply of ORDINARY) {
    it(`does not block: "${reply.slice(0, 42)}..."`, () => {
      const report = checkNamedSources(reply, {
        toolCalls: [],
        evidenceText: "",
        receiptsAvailable: true,
      });
      const g = run(reply, "what should I do", cleanEvidence({ namedSources: report }));
      expect(g.verdict).not.toBe("block");
    });
  }

  it("plain prose yields no named-source claims at all", () => {
    expect(detectNamedSources(ORDINARY.join("\n"))).toHaveLength(0);
  });
});

describe("the ceiling is shape-aware, not assumed to be prose", () => {
  // Self-review 2026-09-10 · the shadow gate hardcoded 300. The ceiling
  // is 40 for sms and 400 for code, so assuming prose corrupts the
  // measurement in BOTH directions on every non-prose turn: a 70-word
  // SMS (175% over its real ceiling) reads as fine, and a healthy
  // 500-word code answer reads as a violation.
  it("exposes the real ceiling per shape", () => {
    expect(shapeCeiling("prose")).toBe(300);
    expect(shapeCeiling("sms")).toBe(40);
    expect(shapeCeiling("code")).toBe(400);
    expect(shapeCeiling("summary")).toBe(120);
  });

  it("falls back to prose for an unknown or missing shape", () => {
    expect(shapeCeiling(undefined)).toBe(300);
    expect(shapeCeiling("not-a-shape")).toBe(300);
  });

  it("a 70-word SMS is an overrun; the same 70 words as prose is not", () => {
    const sms = run(PLAIN_REPLY, ASK, cleanEvidence({ wordCount: 70, lengthCeiling: shapeCeiling("sms") }));
    expect(sms.evidenceSignals.lengthOverrun).toBe(true);
    const prose = run(PLAIN_REPLY, ASK, cleanEvidence({ wordCount: 70, lengthCeiling: shapeCeiling("prose") }));
    expect(prose.evidenceSignals.lengthOverrun).toBe(false);
  });
});
