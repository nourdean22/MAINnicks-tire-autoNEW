/**
 * v10.0.26 · Tests for tracedAiChat helper.
 *
 * Pre-v10.0.26 the helper recorded `result.provider === "none"`
 * (graceful-degradation sentinel from aiChat) as a SUCCESS trace —
 * total provider outage looked green in /system/agent-traces.
 * This suite locks the contract so future refactors can't regress.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentTrace: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  aiChat: vi.fn(),
}));

vi.mock("@/lib/ai/budget", () => ({
  assertWithinBudget: vi.fn().mockResolvedValue({ ok: true, status: { percentUsed: 0 } }),
  BudgetExceededError: class extends Error {
    status: any;
    constructor(status: any) {
      super("Budget exceeded");
      this.status = status;
      this.name = "BudgetExceededError";
    }
  },
}));

import { prisma } from "@/lib/prisma";
import { aiChat } from "@/lib/ai/provider";
import { assertWithinBudget } from "@/lib/ai/budget";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v10.0.26 · tracedAiChat", () => {
  it("records a normal success with errorClass=null", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "the answer",
      provider: "venice",
      model: "venice/m",
    });
    vi.mocked(prisma.agentTrace.create).mockResolvedValueOnce({} as never);

    const result = await tracedAiChat(
      { label: "test", source: "tool" },
      [{ role: "user", content: "hello" }],
      "fast",
    );

    expect(result.content).toBe("the answer");
    // give the fire-and-forget recordTrace a microtask
    await new Promise((r) => setTimeout(r, 0));
    expect(prisma.agentTrace.create).toHaveBeenCalledTimes(1);
    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect(args?.data?.errorClass).toBeNull();
    expect(args?.data?.provider).toBe("venice");
  });

  it("records provider='none' as an error trace (not a silent success)", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "AI is currently unavailable. No provider could be reached.",
      provider: "none",
      model: "none",
    });
    vi.mocked(prisma.agentTrace.create).mockResolvedValueOnce({} as never);

    const result = await tracedAiChat(
      { label: "outage-canary", source: "tool" },
      [{ role: "user", content: "hi" }],
      "fast",
    );

    // Caller still gets the sentinel result so existing logic that
    // checks result.provider === "none" works.
    expect(result.provider).toBe("none");
    await new Promise((r) => setTimeout(r, 0));
    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect(args?.data?.errorClass).toBe("provider_none");
    expect(args?.data?.errorMessage).toContain("all providers");
    // Provider field nulled out so the dashboard doesn't display "none"
    // as if it were a real provider name.
    expect(args?.data?.provider).toBeNull();
  });

  it("records errorClass='aichat_threw' + re-throws on exception", async () => {
    vi.mocked(aiChat).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(prisma.agentTrace.create).mockResolvedValueOnce({} as never);

    await expect(
      tracedAiChat(
        { label: "test", source: "tool" },
        [{ role: "user", content: "hi" }],
      ),
    ).rejects.toThrow("boom");

    await new Promise((r) => setTimeout(r, 0));
    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect(args?.data?.errorClass).toBe("aichat_threw");
    expect(args?.data?.errorMessage).toContain("boom");
  });

  it("propagates parentTraceId for chained calls", async () => {
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "child result",
      provider: "venice",
      model: "venice/m",
    });
    vi.mocked(prisma.agentTrace.create).mockResolvedValueOnce({} as never);

    await tracedAiChat(
      {
        label: "child-call",
        source: "tool",
        parentTraceId: "t_parent_abc",
      },
      [{ role: "user", content: "x" }],
    );

    await new Promise((r) => setTimeout(r, 0));
    const args = vi.mocked(prisma.agentTrace.create).mock.calls[0]?.[0];
    expect(args?.data?.traceId).toBe("t_parent_abc");
    expect(args?.data?.parentId).toBe("t_parent_abc");
  });

  it("passes budgetNearingLimit: true when daily spend is at or above 80%", async () => {
    vi.mocked(assertWithinBudget).mockResolvedValueOnce({
      ok: true,
      status: { percentUsed: 85 } as any,
    });
    vi.mocked(aiChat).mockResolvedValueOnce({
      content: "budget-safe result",
      provider: "openai",
      model: "gpt-4o-mini",
    });
    vi.mocked(prisma.agentTrace.create).mockResolvedValueOnce({} as never);

    const result = await tracedAiChat(
      { label: "budget-test", source: "tool" },
      [{ role: "user", content: "budget query" }],
    );

    expect(result.content).toBe("budget-safe result");
    expect(aiChat).toHaveBeenCalledWith(
      expect.any(Array),
      "reason",
      expect.objectContaining({ budgetNearingLimit: true }),
    );
  });
});
