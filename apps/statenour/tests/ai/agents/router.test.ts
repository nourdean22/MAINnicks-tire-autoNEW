/**
 * tests/ai/agents/router.test.ts · Task #13.
 *
 * Locks the routing contract: feature-flag short-circuit, keyword
 * pre-filter, and the LLM-classifier fallback path. NO real LLM
 * calls — provider.aiChat is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  userPreferenceFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentTrace: { create: vi.fn() },
    userPreference: { findMany: (...args: any[]) => mocks.userPreferenceFindMany(...args) },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  aiChat: vi.fn(),
}));

import { aiChat } from "@/lib/ai/provider";
import { routeMessage, classifyByKeyword } from "@/lib/ai/agents/router";
import { loadFeatureFlagOverrides } from "@/lib/feature-flags";
import { isSpecialistShadowMode, isSpecialistRoutingEnabled } from "@/lib/ai/agents/types";

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.ENABLE_SPECIALIST_ROUTING;
  mocks.userPreferenceFindMany.mockResolvedValue([]);
  await loadFeatureFlagOverrides(true);
});

describe("router · feature flag", () => {
  it("short-circuits to general when ENABLE_SPECIALIST_ROUTING is unset", async () => {
    const decision = await routeMessage({
      messages: [{ role: "user", content: "what is my net worth this month?" }],
    });
    expect(decision.route).toBe("general");
    expect(decision.reason).toBe("routing-disabled");
    expect(decision.confidence).toBe(1);
    // Critically · no LLM call should fire on the disabled path.
    expect(vi.mocked(aiChat)).not.toHaveBeenCalled();
  });

  it("short-circuits to general when flag is 'false'", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "false";
    const decision = await routeMessage({
      messages: [{ role: "user", content: "should I push price up?" }],
    });
    expect(decision.route).toBe("general");
    expect(decision.reason).toBe("routing-disabled");
  });

  it("short-circuits to general on junk flag values (not 'true'/'shadow')", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "1";
    const decision = await routeMessage({
      messages: [{ role: "user", content: "what's my savings rate?" }],
    });
    expect(decision.route).toBe("general");
    expect(decision.reason).toBe("routing-disabled");
  });

  // AG-42 · 'shadow' runs the CLASSIFIER (so the dispatcher can record
  // what would have routed) — the never-dispatch guarantee lives in the
  // chat route, which checks isSpecialistShadowMode() before acting.
  it("classifies (does not short-circuit) when flag is 'shadow'", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "shadow";
    const decision = await routeMessage({
      messages: [{ role: "user", content: "what's my savings rate looking like this month?" }],
    });
    expect(decision.route).toBe("financial-analyst");
    expect(decision.reason).toMatch(/keyword.*financial/);
  });
});

describe("router · keyword pre-filter (with flag ON)", () => {
  beforeEach(() => {
    process.env.ENABLE_SPECIALIST_ROUTING = "true";
  });

  it("routes obvious financial messages without an LLM call", async () => {
    const decision = await routeMessage({
      messages: [
        { role: "user", content: "what's my savings rate looking like this month?" },
      ],
    });
    expect(decision.route).toBe("financial-analyst");
    expect(decision.reason).toMatch(/keyword.*financial/);
    expect(decision.confidence).toBeGreaterThan(0.8);
    expect(vi.mocked(aiChat)).not.toHaveBeenCalled();
  });

  it("routes obvious decision messages without an LLM call", async () => {
    const decision = await routeMessage({
      messages: [
        {
          role: "user",
          content: "should I take the harder job offer or the better-paying one? what's the trade-off?",
        },
      ],
    });
    expect(decision.route).toBe("decision-coach");
    expect(decision.reason).toMatch(/keyword.*decision/);
    expect(decision.confidence).toBeGreaterThan(0.8);
    expect(vi.mocked(aiChat)).not.toHaveBeenCalled();
  });

  it("routes neutral chit-chat to general with no LLM call", async () => {
    const decision = await routeMessage({
      messages: [{ role: "user", content: "hey, how's it going" }],
    });
    expect(decision.route).toBe("general");
    expect(decision.reason).toMatch(/no specialist signals/);
    expect(vi.mocked(aiChat)).not.toHaveBeenCalled();
  });

  it("routes obvious marketing messages without an LLM call", async () => {
    const decision = await routeMessage({
      messages: [
        { role: "user", content: "can you help me design a TikTok strategy for my store?" },
      ],
    });
    expect(decision.route).toBe("marketing-director");
    expect(decision.reason).toMatch(/keyword.*marketing/);
    expect(decision.confidence).toBeGreaterThan(0.8);
    expect(vi.mocked(aiChat)).not.toHaveBeenCalled();
  });

  it("classifies the LATEST user message, not earlier ones", async () => {
    const decision = await routeMessage({
      messages: [
        { role: "user", content: "what's my net worth?" },
        { role: "assistant", content: "About $X." },
        { role: "user", content: "ok cool, now make me a sandwich list" },
      ],
    });
    expect(decision.route).toBe("general");
  });
});

describe("router · LLM fallback (ambiguous messages)", () => {
  beforeEach(() => {
    process.env.ENABLE_SPECIALIST_ROUTING = "true";
  });

  it("calls the LLM when BOTH keyword families match", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: JSON.stringify({
        route: "decision-coach",
        confidence: 0.7,
        reason: "weighted choice between saving more vs spending",
      }),
      provider: "ollama",
      model: "qwen3",
    });

    const decision = await routeMessage({
      messages: [
        {
          role: "user",
          content:
            "should I bump my savings rate this quarter — what's the trade-off vs spending on the trip?",
        },
      ],
    });

    expect(vi.mocked(aiChat)).toHaveBeenCalledTimes(1);
    // taskType=classify per the architecture.
    expect(vi.mocked(aiChat).mock.calls[0]?.[1]).toBe("classify");
    expect(decision.route).toBe("decision-coach");
    expect(decision.reason).toMatch(/^llm:/);
  });

  it("falls back to general when the LLM returns malformed JSON", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "I think it's a decision question, honestly",
      provider: "ollama",
      model: "qwen3",
    });

    const decision = await routeMessage({
      messages: [
        {
          role: "user",
          content:
            "should I bump my savings rate this quarter — what's the trade-off vs spending on the trip?",
        },
      ],
    });

    expect(decision.route).toBe("general");
    expect(decision.reason).toMatch(/parse failed/);
  });

  it("falls back to general when the provider chain fails", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "I'm having trouble connecting...",
      provider: "emergency",
      model: "none",
    });

    const decision = await routeMessage({
      messages: [
        {
          role: "user",
          content:
            "should I bump my savings rate this quarter — what's the trade-off vs spending on the trip?",
        },
      ],
    });

    expect(decision.route).toBe("general");
    expect(decision.reason).toMatch(/classifier provider unavailable/);
  });

  it("falls back to general when the LLM throws", async () => {
    vi.mocked(aiChat).mockRejectedValueOnce(new Error("network down"));

    const decision = await routeMessage({
      messages: [
        {
          role: "user",
          content:
            "should I bump my savings rate this quarter — what's the trade-off vs spending on the trip?",
        },
      ],
    });

    expect(decision.route).toBe("general");
    expect(decision.reason).toMatch(/classifier threw/);
  });

  it("never returns an invalid route value from a model claiming a bogus route", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: JSON.stringify({
        route: "shop-mechanic",
        confidence: 1,
        reason: "made up",
      }),
      provider: "ollama",
      model: "qwen3",
    });

    const decision = await routeMessage({
      messages: [
        {
          role: "user",
          content:
            "should I bump my savings rate this quarter — what's the trade-off vs spending on the trip?",
        },
      ],
    });

    // Bogus route gets coerced to general · safe default.
    expect(decision.route).toBe("general");
  });
});

describe("router · edge cases", () => {
  beforeEach(() => {
    process.env.ENABLE_SPECIALIST_ROUTING = "true";
  });

  it("returns general when there is no user message in the history", async () => {
    const decision = await routeMessage({
      messages: [{ role: "assistant", content: "I said something" }],
    });
    expect(decision.route).toBe("general");
    expect(decision.reason).toBe("no user message");
  });
});

describe("classifyByKeyword (pure helper)", () => {
  it("returns ambiguous for messages matching both families", () => {
    const d = classifyByKeyword(
      "should i bump my savings rate this quarter · what's the trade-off?",
    );
    expect(d.route).toBe("general");
    expect(d.reason).toMatch(/ambiguous/);
  });

  it("returns decision route when only decision family hits", () => {
    expect(classifyByKeyword("should i take the harder job").route).toBe(
      "decision-coach",
    );
  });

  it("returns financial route when only financial family hits", () => {
    expect(classifyByKeyword("what's my net worth this month").route).toBe(
      "financial-analyst",
    );
  });

  it("returns marketing route when only marketing family hits", () => {
    expect(classifyByKeyword("need a new copywriting campaign").route).toBe(
      "marketing-director",
    );
  });

  it("returns general when nothing matches", () => {
    expect(classifyByKeyword("good morning").route).toBe("general");
  });
});

describe("router · database overrides and environment options", () => {
  it("routes when env is true and DB overrides are empty", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "true";
    const decision = await routeMessage({
      messages: [{ role: "user", content: "what's my savings rate?" }],
    });
    expect(decision.route).toBe("financial-analyst");
    expect(decision.reason).toMatch(/keyword.*financial/);
  });

  it("does not route when env is false and DB overrides are empty", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "false";
    const decision = await routeMessage({
      messages: [{ role: "user", content: "what's my savings rate?" }],
    });
    expect(decision.route).toBe("general");
    expect(decision.reason).toBe("routing-disabled");
  });

  it("runs classifier but does not route when env is shadow and DB overrides are empty", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "shadow";
    const decision = await routeMessage({
      messages: [{ role: "user", content: "what's my savings rate?" }],
    });
    expect(decision.route).toBe("financial-analyst");
    expect(decision.reason).toMatch(/keyword.*financial/);
  });

  it("routes when DB override is true, overriding env false", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "false";
    mocks.userPreferenceFindMany.mockResolvedValueOnce([
      { key: "ENABLE_SPECIALIST_ROUTING", value: "true" },
    ]);
    await loadFeatureFlagOverrides(true);

    const decision = await routeMessage({
      messages: [{ role: "user", content: "what's my savings rate?" }],
    });
    expect(decision.route).toBe("financial-analyst");
    expect(decision.reason).toMatch(/keyword.*financial/);
  });

  it("runs classifier but does not route when DB override is shadow, overriding env true", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "true";
    mocks.userPreferenceFindMany.mockResolvedValueOnce([
      { key: "ENABLE_SPECIALIST_ROUTING", value: "shadow" },
    ]);
    await loadFeatureFlagOverrides(true);

    const decision = await routeMessage({
      messages: [{ role: "user", content: "what's my savings rate?" }],
    });
    expect(decision.route).toBe("financial-analyst");
    expect(decision.reason).toMatch(/keyword.*financial/);
  });

  it("falls back to env true after DB override is removed", async () => {
    process.env.ENABLE_SPECIALIST_ROUTING = "true";
    
    // DB has no override
    mocks.userPreferenceFindMany.mockResolvedValueOnce([]);
    await loadFeatureFlagOverrides(true);

    const decision = await routeMessage({
      messages: [{ role: "user", content: "what's my savings rate?" }],
    });
    expect(decision.route).toBe("financial-analyst");
    expect(decision.reason).toMatch(/keyword.*financial/);
  });
});
