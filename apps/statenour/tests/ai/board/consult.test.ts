/**
 * tests/ai/board/consult.test.ts · task #23.
 *
 * Contract test for the multi-advisor board consultation service.
 * Locks the key behaviors:
 *   1. Fans out to all board members in parallel + synthesizes
 *   2. PRESERVES divergence (does NOT blend distinct advisor takes)
 *   3. Degrades gracefully when an advisor fails (others still work)
 *   4. Degrades gracefully when the synthesizer fails (takes still surface)
 *   5. Throws only on unknown boardId
 *   6. Coercion: malformed advisor JSON → degraded take with error field
 *
 * Mocks aiChat · no real LLM calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { agentTrace: { create: vi.fn() } },
}));

vi.mock("@/lib/ai/provider", () => ({
  aiChat: vi.fn(),
}));

import { aiChat } from "@/lib/ai/provider";
import { BOARDS } from "@/lib/ai/board/boards";
import {
  consultBoard,
  __testInternals,
} from "@/lib/ai/board/consult";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Reply factories ────────────────────────────────────────────

function advisorReply(
  lensOneLine: string,
  keyInsight: string,
  recommendation: string,
  opts: { confidence?: number; divergenceFlag?: string } = {},
): string {
  return JSON.stringify({
    lensOneLine,
    keyInsight,
    recommendation,
    confidence: opts.confidence ?? 0.8,
    divergenceFlag: opts.divergenceFlag,
  });
}

function synthesisReply(
  consensus: string[],
  divergences: string[],
  recommendation: string,
  opts: { tension?: string; confidence?: number } = {},
): string {
  return JSON.stringify({
    consensus,
    divergences,
    tension: opts.tension,
    recommendation,
    confidence: opts.confidence ?? 0.7,
  });
}

function venice(content: string) {
  return { content, provider: "venice" as const, model: "venice-uncensored" };
}

// ── Happy path · fan-out + synthesize ─────────────────────────

describe("consultBoard · happy path · strategic board", () => {
  it("fans out to all members in parallel + synthesizes", async () => {
    const board = BOARDS.strategic;
    const memberCount = board.memberIds.length;
    expect(memberCount).toBeGreaterThan(3); // sanity check on board sizing

    // Mock N advisor replies (one per member)
    for (let i = 0; i < memberCount; i++) {
      vi.mocked(aiChat).mockResolvedValueOnce(
        venice(advisorReply(`lens ${i}`, `insight ${i}`, `rec ${i}`)),
      );
    }
    // Then mock the synthesizer reply
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice(synthesisReply(["all agree X"], [], "do X")),
    );

    const result = await consultBoard("strategic", "should I push price up?");

    expect(vi.mocked(aiChat)).toHaveBeenCalledTimes(memberCount + 1);
    expect(result.takes).toHaveLength(memberCount);
    expect(result.synthesis.consensus).toEqual(["all agree X"]);
    expect(result.synthesis.recommendation).toBe("do X");
    expect(result.boardId).toBe("strategic");
    expect(result.boardName).toBe(board.name);
    expect(result.question).toBe("should I push price up?");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("uses taskType='reason' for all aiChat calls", async () => {
    const board = BOARDS.strategic;
    const memberCount = board.memberIds.length;
    for (let i = 0; i < memberCount; i++) {
      vi.mocked(aiChat).mockResolvedValueOnce(
        venice(advisorReply("l", "i", "r")),
      );
    }
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice(synthesisReply([], [], "r")),
    );

    await consultBoard("strategic", "test");

    // Every call should be taskType="reason" · routes to Venice/Ollama first.
    for (const call of vi.mocked(aiChat).mock.calls) {
      expect(call[1]).toBe("reason");
    }
  });
});

// ── Divergence preservation · THE point of the pattern ────────

describe("consultBoard · divergence preservation", () => {
  it("keeps each advisor's take DISTINCT (does not blend them)", async () => {
    const board = BOARDS.strategic;
    const memberCount = board.memberIds.length;

    // Advisor 0 says PUSH · advisor 1 says HOLD · others say MAYBE
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice(
        advisorReply(
          "first principles say push",
          "materials cost X, market price Y — gap is the bet",
          "push +$50",
          { divergenceFlag: "would override warren-buffett's moat caution" },
        ),
      ),
    );
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice(
        advisorReply(
          "moat says hold",
          "raise here erodes the reputation moat that compounds",
          "hold current price",
          { divergenceFlag: "elon-musk would push for the first-principles gap math" },
        ),
      ),
    );
    for (let i = 2; i < memberCount; i++) {
      vi.mocked(aiChat).mockResolvedValueOnce(
        venice(advisorReply(`lens ${i}`, `insight ${i}`, `rec ${i}`)),
      );
    }
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice(
        synthesisReply(
          ["pricing power is genuine here"],
          [
            "elon-musk says push +$50 (first-principles gap) · warren-buffett says hold (moat erosion)",
          ],
          "lean push but slow · acknowledge moat risk by capping at +$25 not +$50",
          { tension: "short-term margin vs long-term moat", confidence: 0.6 },
        ),
      ),
    );

    const result = await consultBoard("strategic", "should I push price up?");

    // Distinct takes preserved verbatim.
    expect(result.takes[0].recommendation).toBe("push +$50");
    expect(result.takes[1].recommendation).toBe("hold current price");
    expect(result.takes[0].divergenceFlag).toContain("moat");
    expect(result.takes[1].divergenceFlag).toContain("first-principles");

    // Synthesis names WHO disagreed with WHO.
    expect(result.synthesis.divergences).toHaveLength(1);
    expect(result.synthesis.divergences[0]).toMatch(/elon-musk/i);
    expect(result.synthesis.divergences[0]).toMatch(/warren-buffett/i);
    expect(result.synthesis.tension).toBe(
      "short-term margin vs long-term moat",
    );
    expect(result.synthesis.confidence).toBe(0.6);
  });
});

// ── Graceful degradation · advisor failures ─────────────────────

describe("consultBoard · advisor failures degrade gracefully", () => {
  it("captures throw as error · other advisors still produce takes", async () => {
    const board = BOARDS.strategic;
    const memberCount = board.memberIds.length;

    // Advisor 0 errors mid-call
    vi.mocked(aiChat).mockRejectedValueOnce(new Error("network down"));
    // Other advisors succeed
    for (let i = 1; i < memberCount; i++) {
      vi.mocked(aiChat).mockResolvedValueOnce(
        venice(advisorReply("l", "i", "r")),
      );
    }
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice(synthesisReply(["partial consensus"], [], "do Y", { confidence: 0.5 })),
    );

    const result = await consultBoard("strategic", "test question");

    expect(result.takes).toHaveLength(memberCount);
    expect(result.takes[0].error).toContain("network down");
    expect(result.takes[0].confidence).toBe(0);
    for (let i = 1; i < memberCount; i++) {
      expect(result.takes[i].error).toBeUndefined();
    }
  });

  it("captures provider sentinel · advisor reports provider unavailable", async () => {
    const board = BOARDS.strategic;
    const memberCount = board.memberIds.length;
    for (let i = 0; i < memberCount; i++) {
      vi.mocked(aiChat).mockResolvedValueOnce({
        content: "n/a",
        provider: "emergency",
        model: "none",
      });
    }
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: synthesisReply([], [], "everyone failed", { confidence: 0 }),
      provider: "emergency",
      model: "none",
    });

    const result = await consultBoard("strategic", "test");
    for (const take of result.takes) {
      expect(take.error).toBe("provider unavailable");
      expect(take.provider).toBe("emergency");
    }
  });

  it("captures parse failure · malformed JSON from advisor", async () => {
    const board = BOARDS.strategic;
    const memberCount = board.memberIds.length;
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice("not json at all · plain prose"),
    );
    for (let i = 1; i < memberCount; i++) {
      vi.mocked(aiChat).mockResolvedValueOnce(
        venice(advisorReply("l", "i", "r")),
      );
    }
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice(synthesisReply([], [], "r")),
    );

    const result = await consultBoard("strategic", "test");
    expect(result.takes[0].error).toMatch(/parse failed/);
    expect(result.takes[0].confidence).toBe(0);
  });
});

// ── Graceful degradation · synthesizer failures ─────────────────

describe("consultBoard · synthesizer failures degrade gracefully", () => {
  it("returns takes + degraded synthesis when synthesizer parse fails", async () => {
    const board = BOARDS.strategic;
    const memberCount = board.memberIds.length;
    for (let i = 0; i < memberCount; i++) {
      vi.mocked(aiChat).mockResolvedValueOnce(
        venice(advisorReply("l", "i", "r")),
      );
    }
    // Synthesizer returns gibberish
    vi.mocked(aiChat).mockResolvedValueOnce(
      venice("gibberish · no json here"),
    );

    const result = await consultBoard("strategic", "test");
    expect(result.takes).toHaveLength(memberCount);
    expect(result.synthesis.recommendation).toMatch(/parse failed/);
    expect(result.synthesis.confidence).toBe(0);
  });
});

// ── Validation · unknown boardId ────────────────────────────────

describe("consultBoard · validation", () => {
  it("throws on unknown board id", async () => {
     
    await expect(consultBoard("nope" as any, "q")).rejects.toThrow(
      /Unknown board/,
    );
  });
});

// ── Coercion · advisor reply field-by-field ─────────────────────

describe("coerceAdvisorTake · defensive shape", () => {
  const frame = {
    id: "test",
    name: "Test Lens",
    oneLiner: "x",
    triggers: [],
    lens: "x",
  };

  it("clamps confidence to [0,1]", () => {
     
    const t = __testInternals.coerceAdvisorTake(frame as any, { confidence: 2.5 }, "v");
    expect(t.confidence).toBe(1);
     
    const t2 = __testInternals.coerceAdvisorTake(frame as any, { confidence: -3 }, "v");
    expect(t2.confidence).toBe(0);
  });

  it("falls back to 0.6 confidence when missing or non-finite", () => {
     
    const t = __testInternals.coerceAdvisorTake(frame as any, {}, "v");
    expect(t.confidence).toBe(0.6);
     
    const t2 = __testInternals.coerceAdvisorTake(frame as any, { confidence: NaN }, "v");
    expect(t2.confidence).toBe(0.6);
  });

  it("substitutes (missing) for absent string fields", () => {
     
    const t = __testInternals.coerceAdvisorTake(frame as any, {}, "v");
    expect(t.lensOneLine).toBe("(missing)");
    expect(t.keyInsight).toBe("(missing)");
    expect(t.recommendation).toBe("(missing)");
  });

  it("preserves valid divergenceFlag", () => {
     
    const t = __testInternals.coerceAdvisorTake(
      frame as any,
      { divergenceFlag: "X would disagree" },
      "v",
    );
    expect(t.divergenceFlag).toBe("X would disagree");
  });

  it("drops empty-string divergenceFlag to undefined", () => {
     
    const t = __testInternals.coerceAdvisorTake(frame as any, { divergenceFlag: "" }, "v");
    expect(t.divergenceFlag).toBeUndefined();
  });
});

// ── Internal prompt construction ─────────────────────────────────

describe("buildAdvisorPrompt (internal)", () => {
  it("embeds the framework lens block + divergence-preservation rule", () => {
    const prompt = __testInternals.buildAdvisorPrompt({
      id: "test",
      name: "Test Lens",
      oneLiner: "x",
      triggers: [],
       
      lens: "TEST LENS BLOCK 12345",
    } as any);
    expect(prompt).toContain("TEST LENS BLOCK 12345");
    expect(prompt).toContain("Test Lens");
    expect(prompt).toMatch(/stay TRUE to your lens/i);
    expect(prompt).toMatch(/don't blend/i);
    expect(prompt).toContain("STRICT JSON");
  });
});

describe("SYNTHESIZE_SYSTEM_PROMPT (internal)", () => {
  it("locks the divergence-preservation contract in the synthesizer prompt", () => {
    const p = __testInternals.SYNTHESIZE_SYSTEM_PROMPT;
    expect(p).toMatch(/SYNTHESIZER/);
    expect(p).toMatch(/CONSENSUS/);
    expect(p).toMatch(/DIVERGENCE/);
    expect(p).toMatch(/TENSION/);
    expect(p).toMatch(/Never blend perspectives into mush/i);
  });
});

// ── Board composition · sanity that all referenced framework ids resolve ───

describe("BOARDS · all member ids resolve in REGISTRY", () => {
  it.each(Object.values(BOARDS))(
    "$id board members resolve to ≥3 real frameworks",
    (board) => {
      const resolved = __testInternals.resolveMembers(board.memberIds);
      // Sanity: at least 3 members resolve · otherwise the board is broken.
      expect(resolved.length).toBeGreaterThanOrEqual(3);
      // Member count should match config (no drift from REGISTRY).
      expect(resolved.length).toBe(board.memberIds.length);
    },
  );
});

// ── AG-42 · persona fallback · the "team" board seats lib/ai/personas ──

describe("resolveMembers · persona fallback (team board)", () => {
  it("adapts a persona into the framework shape when the id misses REGISTRY", () => {
    const resolved = __testInternals.resolveMembers(["tactician"]);
    expect(resolved).toHaveLength(1);
    const m = resolved[0];
    expect(m.id).toBe("tactician");
    expect(m.name).toBe("Tactician");
    // The lens must carry the persona's character so the advisor
    // prompt's "YOUR LENS · use ONLY this" slot has real content.
    expect(m.lens).toMatch(/48 hours/);
    expect(m.lens).toMatch(/GOAL:/);
  });

  it("REGISTRY frameworks still take precedence over personas", () => {
    // elon-musk exists in REGISTRY · must resolve there, not persona-shaped.
    const resolved = __testInternals.resolveMembers(["elon-musk"]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].triggers.length).toBeGreaterThan(0); // real frameworks carry triggers
  });

  it("unknown ids still drop silently", () => {
    expect(__testInternals.resolveMembers(["no-such-member"])).toHaveLength(0);
  });
});
