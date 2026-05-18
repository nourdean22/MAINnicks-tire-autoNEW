/**
 * tests/ai/reasoning/classifier-core.test.ts · Phase P.1 (2026-05-18 PM)
 *
 * Critical-path tests for the isomorphic classifier (H/J/M/N codebase).
 * Pre-P the classifier had ZERO unit tests · all behavior validated
 * by manual /reason e2e + Phase K static scanners. P.1 closes the gap.
 *
 * Test contract:
 *   · operator-explicit /quick override wins over everything
 *   · short questions (<20 chars) classify as quick
 *   · mega markers (operator-explicit only · /mega · @mega · charizard)
 *   · smart markers (M.1 · /smart · @smart · "pick the right")
 *   · thorough markers (research the · due diligence · deep dive)
 *   · deep markers (strategy · investment · architect)
 *   · standard markers (should i · how do i · trade-off · analyze)
 *   · length-based escalation when no markers
 *   · multi-question count escalation
 */

import { describe, expect, it } from "vitest";
import { classifyCore, countSubQuestions } from "@/lib/ai/reasoning/classifier-core";

describe("classifyCore · operator-explicit overrides", () => {
  it("/quick wins over everything", () => {
    const v = classifyCore("/quick what's the strategy for Q2 investment");
    expect(v.tier).toBe("quick");
    expect(v.reason).toContain("/quick");
  });

  it("@quick also wins", () => {
    const v = classifyCore("@quick analyze the trade-off");
    expect(v.tier).toBe("quick");
  });
});

describe("classifyCore · length floor", () => {
  it("classifies short questions as quick regardless of content", () => {
    const v = classifyCore("strategy?");
    expect(v.tier).toBe("quick");
    expect(v.reason).toContain("short");
  });

  it("treats exactly-19-char as quick", () => {
    const v = classifyCore("a".repeat(19));
    expect(v.tier).toBe("quick");
  });
});

describe("classifyCore · mega tier (operator-explicit only)", () => {
  it("matches /mega marker", () => {
    const v = classifyCore("/mega give me everything on this");
    expect(v.tier).toBe("mega");
  });

  it("matches @mega marker", () => {
    const v = classifyCore("@mega spare no expense");
    expect(v.tier).toBe("mega");
  });

  it("matches 'charizard' marker (the easter egg)", () => {
    const v = classifyCore("hit me with the charizard treatment please");
    expect(v.tier).toBe("mega");
  });

  it("matches 'biggest hammer' marker", () => {
    const v = classifyCore("I need the biggest hammer on this decision");
    expect(v.tier).toBe("mega");
  });

  it("never auto-promotes to mega from length alone", () => {
    // 600+ chars without mega markers should NOT become mega
    const longQ = "What do I do? ".repeat(50); // ~700 chars
    const v = classifyCore(longQ);
    expect(v.tier).not.toBe("mega");
  });
});

describe("classifyCore · smart tier (M.1)", () => {
  it("matches /smart marker", () => {
    const v = classifyCore("/smart pick the right approach here");
    expect(v.tier).toBe("smart");
  });

  it("matches 'pick the right' marker", () => {
    const v = classifyCore("Pick the right move for this decision");
    expect(v.tier).toBe("smart");
  });

  it("smart takes precedence over thorough markers", () => {
    // mega + smart + thorough all match · order in classifyCore puts
    // mega first · then smart · then thorough · so a question with
    // both smart + thorough markers should hit smart
    const v = classifyCore("/smart research the market");
    expect(v.tier).toBe("smart");
  });
});

describe("classifyCore · thorough tier", () => {
  it("matches 'due diligence' marker", () => {
    const v = classifyCore("Need to do due diligence on this vendor relationship");
    expect(v.tier).toBe("thorough");
  });

  it("matches 'deep dive' marker", () => {
    const v = classifyCore("Let's do a deep dive on Q3 revenue patterns");
    expect(v.tier).toBe("thorough");
  });

  it("matches 'research the' marker", () => {
    const v = classifyCore("Can you research the competitive landscape here");
    expect(v.tier).toBe("thorough");
  });
});

describe("classifyCore · deep tier", () => {
  it("matches 'strategy' marker", () => {
    const v = classifyCore("What's the long-term strategy for the new bay");
    expect(v.tier).toBe("deep");
  });

  it("matches 'investment' marker", () => {
    const v = classifyCore("Should I make this investment in Q4 inventory");
    // 'investment' is in deep markers but 'should i' is in standard markers
    // Order: mega → smart → thorough → deep → standard, so deep wins
    expect(v.tier).toBe("deep");
  });

  it("matches 'deep think' marker", () => {
    const v = classifyCore("Deep think about whether to hire another tech");
    expect(v.tier).toBe("deep");
  });
});

describe("classifyCore · standard tier", () => {
  it("matches 'should i' marker", () => {
    const v = classifyCore("Should I close the shop at 5pm on Saturdays");
    expect(v.tier).toBe("standard");
  });

  it("matches 'trade-off' marker", () => {
    const v = classifyCore("What's the trade-off between speed and quality here");
    expect(v.tier).toBe("standard");
  });

  it("matches 'how do i' marker", () => {
    const v = classifyCore("How do I improve the customer-callback flow");
    expect(v.tier).toBe("standard");
  });
});

describe("classifyCore · length-based escalation (no markers)", () => {
  it("escalates to deep at 600+ chars", () => {
    const longNoMarker = "Let me describe a situation. ".repeat(25); // ~700 chars · no tier markers
    const v = classifyCore(longNoMarker);
    expect(v.tier).toBe("deep");
  });

  it("escalates to standard at 200-599 chars", () => {
    const medQ = "Let me describe a thing. ".repeat(10); // ~250 chars
    const v = classifyCore(medQ);
    expect(v.tier).toBe("standard");
  });

  it("falls through to quick at <200 chars with no markers + 1 sub-question", () => {
    const shortQ = "Just a simple question here without any tier markers at all";
    const v = classifyCore(shortQ);
    expect(v.tier).toBe("quick");
  });
});

describe("classifyCore · multi-question escalation", () => {
  it("escalates to deep at 3+ sub-questions", () => {
    const multiQ = "First, what's X? Second, how do Y? Third, when Z?";
    const v = classifyCore(multiQ);
    expect(v.tier).toBe("deep");
  });

  it("escalates to standard at 2 sub-questions", () => {
    const v = classifyCore(
      "Some context about my shop. What's the answer? And how would I implement it?",
    );
    expect(v.tier).toBe("standard");
  });
});

describe("countSubQuestions", () => {
  it("counts question marks", () => {
    expect(countSubQuestions("A? B? C?")).toBe(3);
  });

  it("returns 0 for no questions", () => {
    expect(countSubQuestions("just a statement.")).toBe(0);
  });

  it("counts 'and what about' as a conjunction", () => {
    expect(countSubQuestions("X and what about Y?")).toBeGreaterThanOrEqual(1);
  });
});
