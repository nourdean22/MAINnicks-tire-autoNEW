/**
 * Ghost replay · doctrine tests (pure surface).
 *
 * Pins the properties the evolution gate depends on: caller-turn extraction
 * from real vaulted formats, deterministic grading the candidate cannot
 * sweet-talk, a stable train/holdout split, and the invariant guard that
 * bounds what an optimizer may edit away.
 */
import { describe, expect, it } from "vitest";
import {
  extractCallerTurns,
  gradeReplies,
  splitSeeds,
  violatedInvariants,
} from "./ghostReplay";

describe("extractCallerTurns", () => {
  it("parses the vaulted VAPI line format, merging continuations", () => {
    const t = [
      "AI: Nick's Tire and Auto — what can I do for you?",
      "User: yeah do you got a tire",
      "for a 2015 Malibu",
      "AI: Let me check.",
      "User: how much",
    ].join("\n");
    expect(extractCallerTurns(t)).toEqual(["yeah do you got a tire for a 2015 Malibu", "how much"]);
  });

  it("an AI-only transcript (hang-up) yields zero caller turns — seed filter relies on this", () => {
    expect(extractCallerTurns("AI: Nick's Tire and Auto — what can I do for you?\nAI: Is there anything else")).toEqual([]);
  });

  it("accepts Customer/Caller markers and mixed case", () => {
    expect(extractCallerTurns("customer: hi there\nBot: hello\nCALLER: price?")).toEqual(["hi there", "price?"]);
  });
});

describe("gradeReplies", () => {
  it("pass requires resolution AND zero violations AND no empty turns", () => {
    expect(gradeReplies(["Pull up anytime, walk-ins are fine."]).pass).toBe(true);
    expect(gradeReplies(["That'll be $85 for the brake job — walk-in welcome."]).pass).toBe(false); // price leak disqualifies despite resolution
    expect(gradeReplies(["I guarantee we can fix it — come on in."]).pass).toBe(false);
    expect(gradeReplies(["Pull up anytime.", ""]).pass).toBe(false); // silent turn
    expect(gradeReplies(["We're open Sunday."]).pass).toBe(false); // no concrete next step
  });

  it("counts violations per reply for the readout", () => {
    const g = gradeReplies(["$120 today only", "I guarantee it", "book you in?"]);
    expect(g.priceLeaks).toBe(1);
    expect(g.guarantees).toBe(1);
    expect(g.resolutionOffered).toBe(true);
    expect(g.pass).toBe(false);
  });
});

describe("splitSeeds", () => {
  it("is deterministic and disjoint — a candidate can never meet its holdout in training", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => ({ id: `call-${i}-${i * 7919}` }));
    const a = splitSeeds(seeds);
    const b = splitSeeds(seeds);
    expect(a.train.map((s) => s.id)).toEqual(b.train.map((s) => s.id));
    const trainIds = new Set(a.train.map((s) => s.id));
    expect(a.holdout.some((s) => trainIds.has(s.id))).toBe(false);
    expect(a.train.length + a.holdout.length).toBe(40);
    expect(a.holdout.length).toBeGreaterThan(5); // ~40% of 40
  });
});

describe("violatedInvariants", () => {
  it("a candidate that edits away the compliance spine is named, not scored", () => {
    expect(violatedInvariants("You are a generic helpful assistant.")).toEqual(["identity", "no-price-quotes", "tire-first"]);
    expect(violatedInvariants("You're the AI receptionist for Nick's Tire. Never quote repair prices. Default tire-first.")).toEqual([]);
  });
});
