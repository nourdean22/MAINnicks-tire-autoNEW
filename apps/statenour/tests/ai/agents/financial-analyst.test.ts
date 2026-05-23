/**
 * tests/ai/agents/financial-analyst.test.ts · Task #13.
 *
 * Locks the financial-analyst specialist contract: system-prompt
 * framing, hand-back marker stripping, provider-failure path.
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
  runFinancialAnalyst,
  __testInternals,
} from "@/lib/ai/agents/specialists/financial-analyst";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("financial-analyst · system prompt framing", () => {
  it("ships the financial-analyst persona block to aiChat", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Your savings rate is 22% this month.",
      provider: "ollama",
      model: "qwen3",
    });

    await runFinancialAnalyst({
      messages: [{ role: "user", content: "what's my savings rate?" }],
    });

    const messages = vi.mocked(aiChat).mock.calls[0]?.[0];
    expect(messages).toBeTruthy();
    expect(messages?.[0].role).toBe("system");
    expect(messages?.[0].content).toContain("FINANCIAL ANALYST");
    // Critical biases that distinguish this specialist from general Nick:
    expect(messages?.[0].content).toMatch(/savings rate/i);
    expect(messages?.[0].content).toMatch(/net worth/i);
    expect(messages?.[0].content).toMatch(/grounded/i);
    // Hand-back protocol must be present.
    expect(messages?.[0].content).toContain("[[HANDBACK:");
  });

  it("includes the full conversation history after the system prompt", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "OK.",
      provider: "ollama",
      model: "qwen3",
    });

    await runFinancialAnalyst({
      messages: [
        { role: "user", content: "first message" },
        { role: "assistant", content: "first reply" },
        { role: "user", content: "second user message" },
      ],
    });

    const messages = vi.mocked(aiChat).mock.calls[0]?.[0];
    expect(messages?.length).toBe(4); // 1 system + 3 history
    expect(messages?.[3].role).toBe("user");
    expect(messages?.[3].content).toBe("second user message");
  });
});

describe("financial-analyst · hand-back marker stripping", () => {
  it("strips a [[HANDBACK: reason]] marker and reports handBack=true", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content:
        "Net worth is $X. Savings rate up 3pts.\n[[HANDBACK: user pivoted to scheduling]]",
      provider: "ollama",
      model: "qwen3",
    });

    const result = await runFinancialAnalyst({
      messages: [
        { role: "user", content: "what's my net worth" },
        { role: "assistant", content: "..." },
        { role: "user", content: "ok schedule a meeting Thursday" },
      ],
    });

    expect(result.handBack).toBe(true);
    expect(result.reason).toContain("scheduling");
    // Content has the marker stripped.
    expect(result.content).not.toContain("HANDBACK");
    expect(result.content).toContain("Net worth is $X");
  });

  it("returns handBack=false when no marker is present", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "Savings rate 22%. Spending up in dining.",
      provider: "venice",
      model: "venice-uncensored",
    });

    const result = await runFinancialAnalyst({
      messages: [{ role: "user", content: "spending categories?" }],
    });

    expect(result.handBack).toBe(false);
    expect(result.content).toBe("Savings rate 22%. Spending up in dining.");
  });
});

describe("financial-analyst · provider failure path", () => {
  it("returns a hand-back when aiChat reports provider='none'", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "AI is currently unavailable.",
      provider: "none",
      model: "none",
    });

    const result = await runFinancialAnalyst({
      messages: [{ role: "user", content: "net worth?" }],
    });

    expect(result.handBack).toBe(true);
    expect(result.reason).toContain("providers unavailable");
    expect(result.provider).toBe("none");
  });

  it("returns a hand-back when aiChat reports provider='emergency'", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "I'm having trouble connecting...",
      provider: "emergency",
      model: "none",
    });

    const result = await runFinancialAnalyst({
      messages: [{ role: "user", content: "net worth?" }],
    });

    expect(result.handBack).toBe(true);
    expect(result.provider).toBe("emergency");
  });
});

describe("financial-analyst · internals (sanity check)", () => {
  it("exports the system prompt under __testInternals for forensic review", () => {
    expect(__testInternals.FINANCIAL_SYSTEM_PROMPT).toContain(
      "FINANCIAL ANALYST",
    );
  });
});
