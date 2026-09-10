/**
 * TURN RISK + REGISTER tests -- 2026-09-10.
 *
 * Cases are drawn from the 2026-09-10 audit transcript wherever it
 * quoted a real turn, so this doubles as the transcript-derived golden
 * set for the register work.
 *
 * The load-bearing section is the LAST one. This classifier decides
 * which turns get buffered, and buffering costs 1-3s of latency. A
 * classifier that fires on ordinary conversation would trade away the
 * product's best property to catch a class of error that ordinary
 * conversation cannot contain. Over-triggering is the expensive
 * failure here, not under-triggering -- so the negative cases are
 * asserted harder than the positive ones.
 */
import { describe, it, expect } from "vitest";
import { assessTurnRisk, buildRegisterBlock } from "@/lib/ai/chat/turn-risk";

const noTools = { toolsExpected: false };
const withTools = { toolsExpected: true };

describe("buffering fires where the gate has something to catch", () => {
  it("the audit's own turn: asking for exclusive resources", () => {
    const a = assessTurnRisk("give me the most exclusive and clever resources on this", noTools);
    expect(a.signals.expectsNamedResources).toBe(true);
    expect(a.buffer).toBe(true);
    expect(a.risk).toBe("high");
  });

  it("recommendation asks in the reverse phrasing", () => {
    expect(assessTurnRisk("what channels are worth following for this", noTools).buffer).toBe(true);
    expect(assessTurnRisk("recommend me some books on stoicism", noTools).buffer).toBe(true);
    expect(assessTurnRisk("any good podcasts on power dynamics?", noTools).buffer).toBe(true);
  });

  it("the Adderall/caffeine stacking turn buffers and registers as health", () => {
    const a = assessTurnRisk(
      "if I take my adderall XR at 7am and a pre-workout at 4pm what's the caffeine load",
      noTools,
    );
    expect(a.signals.healthDomain).toBe(true);
    expect(a.register).toBe("health");
    expect(a.buffer).toBe(true);
  });

  it("a lookup with no tool behind it buffers; the same lookup WITH a tool does not", () => {
    const q = "who is the guy that wrote the book on this";
    expect(assessTurnRisk(q, noTools).buffer).toBe(true);
    // A receipt will exist, so there is nothing for the gate to catch.
    expect(assessTurnRisk(q, withTools).signals.factualWithoutTool).toBe(false);
  });
});

describe("register is keyed to content, not to a mode toggle", () => {
  it("the iOS backgrounding turn is TECHNICAL and drops the imperative close", () => {
    // The audit singled this turn out as the one NICK already got right,
    // by accident. It has to be reachable on purpose.
    const a = assessTurnRisk("why does the app stop responding when I background it", noTools);
    expect(a.register).toBe("technical");
    const block = buildRegisterBlock(a);
    expect(block).toMatch(/senior engineer/i);
    expect(block).toMatch(/drop the imperative close/i);
    expect(block).toMatch(/overrides/i); // must countermand the persona block
  });

  it("auditing NICK itself is META, not warrior register", () => {
    const a = assessTurnRisk("audit yourself -- why did you claim you pinned that?", noTools);
    expect(a.register).toBe("meta");
    const block = buildRegisterBlock(a);
    expect(block).toMatch(/cold and analytical/i);
    expect(block).toMatch(/no warrior register/i);
  });

  it("HEALTH forbids stating a pharmacokinetic figure as fact", () => {
    const a = assessTurnRisk("when does the second bead of the XR peak", noTools);
    expect(a.register).toBe("health");
    const block = buildRegisterBlock(a);
    expect(block).toMatch(/never state a pharmacokinetic figure/i);
    expect(block).toMatch(/cardiovascular/i);
    expect(block).toMatch(/ONCE/); // named once, not repeated every turn
  });

  it("health outranks technical when a turn is both", () => {
    const a = assessTurnRisk("the dosing calculator in the app crashes at 40mg", noTools);
    expect(a.signals.technical).toBe(true);
    expect(a.register).toBe("health");
  });

  // CONTROL: a coaching turn must keep the shape that already works.
  it("CONTROL - a drift/coaching turn stays COACHING and emits no override", () => {
    const a = assessTurnRisk("I keep putting off the gym, what do I do", noTools);
    expect(a.register).toBe("coaching");
    expect(buildRegisterBlock(a)).toBe("");
  });
});

describe("commitments demand earned agreement, in any register", () => {
  it("'starting tomorrow' flags adversarial handling", () => {
    const a = assessTurnRisk("I'm cutting back on the stims starting tomorrow", noTools);
    expect(a.adversarialRequired).toBe(true);
    const block = buildRegisterBlock(a);
    expect(block).toMatch(/stated before without starting/i);
    expect(block).toMatch(/what is different this time/i);
  });

  /**
   * The design point: that turn is health-registered AND a commitment.
   * Collapsing them into one bucket would drop whichever lost, which is
   * how "brutal honesty" ended up applying to caffeine math and not to
   * the thing that actually mattered.
   */
  it("adversarial is independent of register, so a health commitment keeps both", () => {
    const a = assessTurnRisk("I'm cutting my adderall dose starting monday", noTools);
    expect(a.register).toBe("health");
    expect(a.adversarialRequired).toBe(true);
    const block = buildRegisterBlock(a);
    expect(block).toMatch(/pharmacokinetic/i);
    expect(block).toMatch(/what is different this time/i);
  });

  it("CONTROL - a plain statement of fact is not a commitment", () => {
    expect(assessTurnRisk("I went to the gym today", noTools).adversarialRequired).toBe(false);
    expect(assessTurnRisk("the gym was closed", noTools).adversarialRequired).toBe(false);
  });
});

describe("FALSE-POSITIVE FLOOR -- ordinary conversation must keep streaming", () => {
  // Over-buffering is the expensive failure: it costs latency on every
  // turn it touches, to catch a class of error these turns cannot
  // contain. Experiment E3 measures the real share; this pins the floor.
  const ORDINARY = [
    "morning",
    "what's on today",
    "I'm stuck",
    "that landed, thanks",
    "keep going",
    "I went for a run this morning and felt good",
    "not feeling it today honestly",
    "yeah that's fair",
    "do it",
    "what do you think about how yesterday went",
    "I'm tired",
    "remind me what we decided",
    "ok let's do the other one instead",
  ];

  for (const t of ORDINARY) {
    it(`does not buffer: "${t}"`, () => {
      expect(assessTurnRisk(t, noTools).buffer).toBe(false);
    });
  }

  it("the buffered share over ordinary turns is zero", () => {
    const buffered = ORDINARY.filter((t) => assessTurnRisk(t, noTools).buffer).length;
    expect(buffered).toBe(0);
  });

  it("empty and trivial input never buffers and never crashes", () => {
    for (const t of ["", "   ", "?", "k"]) {
      const a = assessTurnRisk(t, noTools);
      expect(a.buffer).toBe(false);
      expect(a.register).toBe("coaching");
    }
  });
});
