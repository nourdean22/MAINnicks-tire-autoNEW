/**
 * tests/ai/agents/decision-coach.test.ts · Task #13.
 *
 * Mirrors the financial-analyst test shape · locks the
 * decision-coach contract: persona framing, hand-back stripping,
 * provider-failure path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentTrace: { create: vi.fn() },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  aiChat: vi.fn(),
}));

import { aiChat } from "@/lib/ai/provider";
import {
  runDecisionCoach,
  __testInternals,
} from "@/lib/ai/agents/specialists/decision-coach";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decision-coach · system prompt framing", () => {
  it("ships the decision-coach persona block to aiChat", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Lean toward option A · the recovery path is cheaper.",
      provider: "ollama",
      model: "qwen3",
    });

    await runDecisionCoach({
      messages: [
        { role: "user", content: "should I push price up on brake jobs?" },
      ],
    });

    const messages = vi.mocked(aiChat).mock.calls[0]?.[0];
    expect(messages).toBeTruthy();
    expect(messages?.[0].role).toBe("system");
    expect(messages?.[0].content).toContain("DECISION COACH");
    // Critical biases for this specialist.
    expect(messages?.[0].content).toMatch(/trade.?off/i);
    expect(messages?.[0].content).toMatch(/recovery path/i);
    expect(messages?.[0].content).toMatch(/ghost.?nour|past nour/i);
    // The "no it depends" refusal must be present.
    expect(messages?.[0].content.toLowerCase()).toContain("it depends");
    // Hand-back protocol must be present.
    expect(messages?.[0].content).toContain("[[HANDBACK:");
  });

  it("includes the full conversation history after the system prompt", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "OK.",
      provider: "ollama",
      model: "qwen3",
    });

    await runDecisionCoach({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "first reply" },
        { role: "user", content: "second" },
      ],
    });

    const messages = vi.mocked(aiChat).mock.calls[0]?.[0];
    expect(messages?.length).toBe(4);
    expect(messages?.[3].content).toBe("second");
  });
});

describe("decision-coach · hand-back marker stripping", () => {
  it("strips marker + reports handBack=true when present", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content:
        "Trade-off is margin vs volume. Lean push.\n[[HANDBACK: user pivoted to a money snapshot]]",
      provider: "ollama",
      model: "qwen3",
    });

    const result = await runDecisionCoach({
      messages: [
        { role: "user", content: "should i push price up" },
        { role: "assistant", content: "..." },
        { role: "user", content: "ok now what's my net worth" },
      ],
    });

    expect(result.handBack).toBe(true);
    expect(result.reason).toContain("money snapshot");
    expect(result.content).not.toContain("HANDBACK");
    expect(result.content).toContain("Trade-off");
  });

  it("returns handBack=false when no marker is present", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Lean push. Volume risk is small at +$20.",
      provider: "venice",
      model: "venice-uncensored",
    });

    const result = await runDecisionCoach({
      messages: [{ role: "user", content: "should I raise price?" }],
    });

    expect(result.handBack).toBe(false);
    expect(result.content).toBe("Lean push. Volume risk is small at +$20.");
  });
});

describe("decision-coach · provider failure path", () => {
  it("returns a hand-back when aiChat reports provider='none'", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "AI is currently unavailable.",
      provider: "none",
      model: "none",
    });

    const result = await runDecisionCoach({
      messages: [{ role: "user", content: "should i push?" }],
    });

    expect(result.handBack).toBe(true);
    expect(result.reason).toContain("providers unavailable");
  });

  it("returns a hand-back when aiChat reports provider='emergency'", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "I'm having trouble connecting...",
      provider: "emergency",
      model: "none",
    });

    const result = await runDecisionCoach({
      messages: [{ role: "user", content: "should i push?" }],
    });

    expect(result.handBack).toBe(true);
    expect(result.provider).toBe("emergency");
  });
});

describe("decision-coach · internals (sanity check)", () => {
  it("exports the system prompt under __testInternals", () => {
    expect(__testInternals.DECISION_SYSTEM_PROMPT).toContain("DECISION COACH");
  });
});
