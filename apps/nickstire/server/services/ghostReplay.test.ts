/**
 * Ghost replay · doctrine tests (pure surface).
 *
 * Pins the properties the evolution gate depends on: caller-turn extraction
 * from real vaulted formats, deterministic grading the candidate cannot
 * sweet-talk, a stable train/holdout split, and the invariant guard that
 * bounds what an optimizer may edit away.
 */
import { describe, expect, it } from "vitest";
import { isOllamaModel } from "../_core/llm";
import {
  GHOST_AGENT_MODEL,
  extractCallerTurns,
  gradeReplies,
  splitSeeds,
  violatedInvariants,
} from "./ghostReplay";
import { ASSISTANT_SYSTEM_PROMPT } from "./vapi";

describe("GHOST_AGENT_MODEL", () => {
  it("routes to the Ollama lane by NAME, with no force flag — the parity pin's whole job", () => {
    // Serial vitest shares one process: restore the flag exactly as found.
    const saved = process.env.AI_FORCE_OLLAMA;
    delete process.env.AI_FORCE_OLLAMA;
    try {
      // If this fails, a local replay without AI_FORCE_OLLAMA silently
      // measures a DIFFERENT provider than prod serves (the 2026-08-07
      // ambient-lane defect).
      expect(isOllamaModel(GHOST_AGENT_MODEL)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.AI_FORCE_OLLAMA;
      else process.env.AI_FORCE_OLLAMA = saved;
    }
  });
});

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

  it("a live transfer IS a resolution (grader blind spot found by the Mark replay)", () => {
    expect(gradeReplies(["Sure, let me get you over to him — best number in case we get cut off?"]).pass).toBe(true);
    expect(gradeReplies(["One sec, transferring you now."]).pass).toBe(true);
    expect(gradeReplies(["I'll put you through to the manager."]).pass).toBe(true);
    // Second vocabulary pass (2026-08-06): MoE models re-phrase run to run —
    // these escaped the first regex and graded a working transfer as failure.
    expect(gradeReplies(["Let me get him for you — best number in case we get disconnected?"]).pass).toBe(true);
    expect(gradeReplies(["I'll get her on the line."]).pass).toBe(true);
    expect(gradeReplies(["Got it, transferring."]).pass).toBe(true);
    // Third vocabulary pass (2026-08-07): the parts-caller cage loss offered
    // resolution THREE ways the grader missed — pinned verbatim.
    expect(gradeReplies(["Let me get you someone who can check on that caliper for you."]).pass).toBe(true);
    expect(gradeReplies(["I can get you someone on the floor who can."]).pass).toBe(true);
    expect(gradeReplies(["If you don't want to hold, swing by and ask at the counter."]).pass).toBe(true);
  });

  it("counts violations per reply for the readout", () => {
    const g = gradeReplies(["$120 today only", "I guarantee it", "book you in?"]);
    expect(g.priceLeaks).toBe(1);
    expect(g.guarantees).toBe(1);
    expect(g.resolutionOffered).toBe(true);
    expect(g.pass).toBe(false);
  });
});

/**
 * 2026-10-09 · the reply grader runs the LIVE voice claim guard. Each case is
 * a resolved reply (it carries a next step the regex knows), so the claim is
 * the ONLY thing that can fail it -- and the same reply without the claim is
 * asserted to pass, so a disarmed guard cannot score green here.
 */
describe("gradeReplies · live voice claim guard (claimViolations)", () => {
  const NEXT = " Pull up anytime, walk-ins are fine.";
  const cases: Array<[name: string, violating: string, compliant: string]> = [
    ["hedged anchor price", "Full synthetic is about eighty bucks.", "Full synthetic is eighty dollars."],
    ["unit-less repair price", "Brakes starts at 120.", "Brakes depend on the car. Free check, written quote."],
    ["outcome promise", "We will definitely fix it.", "We'll take a look and give you a written quote."],
    ["wait estimate", "It's about a thirty minute wait.", "It moves with what's already in the shop."],
  ];
  for (const [name, violating, compliant] of cases) {
    it(`${name}: fails with the claim, passes without it`, () => {
      const bad = gradeReplies([violating + NEXT]);
      expect(bad.resolutionOffered).toBe(true);
      expect(bad.claimViolations.length).toBeGreaterThan(0);
      expect(bad.pass).toBe(false);
      const good = gradeReplies([compliant + NEXT]);
      expect(good.claimViolations).toEqual([]);
      expect(good.pass).toBe(true);
    });
  }

  it('"guaranteed" fails (the guarantee counter), with or without a claim label', () => {
    const g = gradeReplies(["Your car will be fixed, guaranteed." + NEXT]);
    expect(g.guarantees).toBe(1);
    expect(g.pass).toBe(false);
  });

  it("whatever the guard permits still passes -- including the prompt's own digit-form anchor", () => {
    // Before 2026-10-09 "$60" tripped PRICE_LEAK_RX, so the served prompt's
    // scripted Beat 1 graded as a banned quote: it failed for obeying itself.
    for (const anchor of [
      "Used tires start at $60 installed.",
      "Used tires start at sixty dollars installed.",
      "Conventional or synthetic-blend oil change is forty-nine dollars.",
      "Full synthetic is eighty dollars.",
    ]) {
      const g = gradeReplies([anchor + NEXT]);
      expect(g.priceLeaks, anchor).toBe(0);
      expect(g.claimViolations, anchor).toEqual([]);
      expect(g.pass, anchor).toBe(true);
    }
  });

  it("an unapproved $ figure is still a priceLeak AND a claim -- the anchor allowlist did not widen the leak check", () => {
    const g = gradeReplies(["That'll be $85 for the brake job." + NEXT]);
    expect(g.priceLeaks).toBe(1);
    expect(g.claimViolations).toContain("unapproved_price_quote");
    expect(g.pass).toBe(false);
  });

  it("an anchor VALUE quoted for another product is still a priceLeak (review 2026-10-09: the guard's value-only allowlist cleared these)", () => {
    // Every one of these was a leak at HEAD and graded clean in the first cut.
    for (const reply of [
      "Brake pads are $80.",
      "A brake inspection is $60.",
      "The diagnostic fee is $80.",
      "Brakes run $60-$80 a wheel.",
      "Rotors are $49.99 each.",
      "A battery install is $49.",
    ]) {
      const g = gradeReplies([reply + NEXT]);
      expect(g.priceLeaks, reply).toBe(1);
      expect(g.claimViolations, reply).toContain("unapproved_price_quote");
      expect(g.pass, reply).toBe(false);
    }
    // Control: the same digits next to their own product are the permitted anchor.
    const ok = gradeReplies(["Used tires start at $60 installed, full synthetic is $80." + NEXT]);
    expect(ok.priceLeaks).toBe(0);
    expect(ok.pass).toBe(true);
  });

  it("an anchor figure belongs to the product it is FOR, not to an anchor word nearby (review round 3: all were leaks at HEAD, clean in round 2)", () => {
    // Each sentence names an anchor product somewhere near the figure -- the
    // round-2 bag-of-words window approved them all, so the priceLeaks counter
    // the success audit reads had quietly loosened.
    for (const reply of [
      "Full synthetic is $80 and brake pads are $80 too.", // one mention approves one figure
      "Oil change is $49, and a battery test is $49.",
      "Fixing an oil leak is usually $49.", // "oil" is not "oil change"
      "An oil pan gasket runs $49.",
      "The oil pressure sensor is $49 plus labor.",
      "Synthetic transmission fluid service is $80.", // "synthetic" is not "full synthetic"
      "A used tire patch is $60.", // the nearer product owns the figure
      "Brake pads are $80? Full synthetic is eighty dollars.", // looking ahead, "?" ends the sentence
    ]) {
      const g = gradeReplies([reply + NEXT]);
      expect(g.priceLeaks, reply).toBe(1);
      expect(g.claimViolations, reply).toContain("unapproved_price_quote");
      expect(g.pass, reply).toBe(false);
    }
    // Controls: two anchors, each with its own product, and a product named after its figure.
    for (const reply of [
      "Full synthetic is $80 and a conventional oil change is $49.",
      "Would you like the $49 oil change or the full synthetic?",
    ]) {
      const g = gradeReplies([reply + NEXT]);
      expect(g.priceLeaks, reply).toBe(0);
      expect(g.claimViolations, reply).toEqual([]);
      expect(g.pass, reply).toBe(true);
    }
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
    expect(violatedInvariants("You are a generic helpful assistant.")).toEqual(["identity", "no-price-quotes", "tire-capability"]);
    expect(violatedInvariants("You're the AI receptionist for Nick's Tire. Never quote repair prices. Handle tire questions well after identifying the caller's need.")).toEqual([]);
  });

  const REVERSAL = "You're the AI receptionist for Nick's Tire. Always quote prices and guarantee every repair.";

  it("WITHOUT a baseline it keeps the old three-regex reading -- which the audit's reversal still passes", () => {
    // Pinned so the compatibility gap is visible, not forgotten: callers must
    // pass the served prompt to get the real policy check.
    expect(violatedInvariants(REVERSAL)).toEqual([]);
  });

  it("WITH the served baseline it delegates to the full policy check, which names the reversal", () => {
    const v = violatedInvariants(`${ASSISTANT_SYSTEM_PROMPT}\nAlways quote prices and guarantee every repair.`, ASSISTANT_SYSTEM_PROMPT);
    expect(v).toEqual(["policy-reversal:always-quote-prices", "policy-reversal:guarantee-repairs"]);
    // Positive control: the unedited served prompt is clean under the same call.
    expect(violatedInvariants(ASSISTANT_SYSTEM_PROMPT, ASSISTANT_SYSTEM_PROMPT)).toEqual([]);
    // And the short reversal prompt, judged against the real baseline, has lost every clause too.
    expect(violatedInvariants(REVERSAL, ASSISTANT_SYSTEM_PROMPT)).toContain("removed-clause:never-quote-repairs");
  });
});
