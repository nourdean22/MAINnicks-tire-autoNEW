/**
 * Semantic resolution judge · doctrine tests (pure surface + escalation contract).
 *
 * The judge exists to fix two measured defects — vocabulary drift and
 * unresolvable seeds — WITHOUT becoming a way for a bad prompt to pass. These
 * tests pin both halves: what it may do, and what it must never do.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJudgePrompt, parseJudgeVerdict, renderDialogue, RESOLUTION_JUDGE_MODEL } from "./resolutionJudge";
import { gradeRepliesWithJudge } from "./ghostReplay";
import { isOllamaModel } from "../_core/llm";

afterEach(() => {
  vi.doUnmock("./resolutionJudge");
  vi.resetModules();
});

describe("judge lane pinning", () => {
  it("routes to Ollama BY NAME with no force flag, like every other pinned lane", () => {
    const saved = process.env.AI_FORCE_OLLAMA;
    delete process.env.AI_FORCE_OLLAMA;
    try {
      expect(isOllamaModel(RESOLUTION_JUDGE_MODEL)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.AI_FORCE_OLLAMA;
      else process.env.AI_FORCE_OLLAMA = saved;
    }
  });

  it("is a DIFFERENT family from the receptionist lane under test", async () => {
    const { GHOST_AGENT_MODEL } = await import("./ghostReplay");
    // A model grading its own family's phrasing is the self-eval defect this
    // whole arc exists to remove.
    expect(RESOLUTION_JUDGE_MODEL).not.toBe(GHOST_AGENT_MODEL);
  });
});

describe("parseJudgeVerdict", () => {
  it("reads a verdict out of prose-wrapped JSON", () => {
    const v = parseJudgeVerdict('Sure! {"verdict":"resolved","reason":"offered a transfer"} hope that helps');
    expect(v.verdict).toBe("resolved");
    expect(v.reason).toBe("offered a transfer");
  });

  it("THROWS on an unknown or missing verdict — never defaults to a pass", () => {
    expect(() => parseJudgeVerdict('{"verdict":"maybe"}')).toThrow(/unknown verdict/);
    expect(() => parseJudgeVerdict("no json here")).toThrow(/no JSON object/);
    expect(() => parseJudgeVerdict("{}")).toThrow(/unknown verdict/);
  });
});

describe("renderDialogue / buildJudgePrompt", () => {
  it("interleaves turns and marks a missing reply rather than dropping it", () => {
    expect(renderDialogue(["hi", "how much"], ["hello"])).toBe(
      "Caller: hi\nReceptionist: hello\nCaller: how much\nReceptionist: (no reply)",
    );
  });

  it("names all three verdicts and the wrong-number/hang-up case that motivated it", () => {
    const p = buildJudgePrompt();
    expect(p).toContain("unresolvable");
    expect(p).toContain("wrong number");
    // The exact seed-019fd32f shape: caller left before asking anything.
    expect(p.toLowerCase()).toContain("hung up");
  });
});

describe("gradeRepliesWithJudge · escalation contract", () => {
  it("a regex HIT never calls the judge (deterministic fast path stays free)", async () => {
    const spy = vi.fn();
    vi.doMock("./resolutionJudge", () => ({ judgeResolution: spy }));
    vi.resetModules();
    const { gradeRepliesWithJudge: graded } = await import("./ghostReplay");
    const g = await graded(["do you have tires"], ["Pull up anytime, walk-ins are fine."]);
    expect(g.pass).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("judge 'resolved' rescues a vocabulary miss into a pass", async () => {
    vi.doMock("./resolutionJudge", () => ({
      judgeResolution: async () => ({ verdict: "resolved", reason: "offered to fetch a person" }),
    }));
    vi.resetModules();
    const { gradeRepliesWithJudge: graded } = await import("./ghostReplay");
    const g = await graded(["is the boss around"], ["Hang tight, I'll grab whoever's up front for ya."]);
    expect(g.resolutionOffered).toBe(true);
    expect(g.pass).toBe(true);
    expect(g.judgeReason).toBe("offered to fetch a person");
  });

  it("judge 'unresolvable' marks the seed for EXCLUSION, and does not fake a pass", async () => {
    vi.doMock("./resolutionJudge", () => ({
      judgeResolution: async () => ({ verdict: "unresolvable", reason: "wrong number, caller gone" }),
    }));
    vi.resetModules();
    const { gradeRepliesWithJudge: graded } = await import("./ghostReplay");
    // The real seed 019fd32f dialogue.
    const g = await graded(
      ["Hello?", "Is this Nick's Auto Parts? Nick's"],
      ["Yep, I'm here — what can I do for ya?", "You reached Nick's Tire & Auto on Euclid — calling about tires, brakes, or auto repair?"],
    );
    expect(g.unresolvable).toBe(true);
    expect(g.pass).toBe(false); // excluded from the denominator, NOT counted as a win
    expect(g.resolutionOffered).toBe(false);
  });

  it("THE JUDGE CANNOT OVERTURN A VIOLATION — a price leak still fails even on 'resolved'", async () => {
    vi.doMock("./resolutionJudge", () => ({
      judgeResolution: async () => ({ verdict: "resolved", reason: "booked them in" }),
    }));
    vi.resetModules();
    const { gradeRepliesWithJudge: graded } = await import("./ghostReplay");
    const leak = await graded(["how much for brakes"], ["Around $240 — I'll get you on the books."]);
    expect(leak.resolutionOffered).toBe(true);
    expect(leak.pass).toBe(false); // a resolution won by quoting a banned price is a compliance failure
    const guarantee = await graded(["can you fix it"], ["I guarantee we'll sort it — I'll grab someone."]);
    expect(guarantee.pass).toBe(false);
    const empty = await graded(["you there", "hello"], ["I'll get someone for you", ""]);
    expect(empty.pass).toBe(false);
  });

  it("a DEAD judge lane never manufactures a pass — the regex verdict stands, loudly", async () => {
    vi.doMock("./resolutionJudge", () => ({
      judgeResolution: async () => ({ verdict: "unresolved", reason: "judge unavailable: 402", judgeUnavailable: true }),
    }));
    vi.resetModules();
    const { gradeRepliesWithJudge: graded } = await import("./ghostReplay");
    const g = await graded(["how much"], ["We're open till six."]);
    expect(g.pass).toBe(false);
    expect(g.judgeUnavailable).toBe(true);
    expect(g.unresolvable).toBeUndefined(); // a dead judge must not silently excuse a seed
  });
});

// Referenced so the direct import is exercised even when every case mocks it.
describe("module surface", () => {
  it("exports the graded entry point", () => {
    expect(typeof gradeRepliesWithJudge).toBe("function");
  });
});
