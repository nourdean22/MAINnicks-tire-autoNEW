/**
 * Audit 2026-10-10 08-F5: the aiChat outage sentinel (non-empty, > 20 chars)
 * was stored as a tool-description draft. Worse, the draft row carries the
 * description fingerprint, so every later run hits `skippedExisting` and the
 * real draft is never written. A sentinel must be a failed draft, not stored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));

const mem = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mem,
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/ai/tool-telemetry", () => ({
  getToolStats: vi.fn().mockResolvedValue([
    {
      toolName: "findCustomer",
      totalCalls: 40,
      successRate: 0.2,
      avgDurationMs: 100,
      failCount: 32,
      lastErrors: [{ message: "customer not found", at: 1 }],
    },
  ]),
}));
vi.mock("@/lib/observability/tool-usage-census", () => ({
  buildToolUsageCensus: vi.fn().mockRejectedValue(new Error("census offline in test")),
}));
vi.mock("@/lib/ai/tools", () => ({
  nourTools: { findCustomer: { description: "Find a customer by name or phone." } },
}));

import { runToolDescriptionRewrite } from "@/lib/ai/tool-description-rewrite";

beforeEach(() => {
  mockChat.mockReset();
  mem.findUnique.mockReset().mockResolvedValue(null);
  mem.upsert.mockReset().mockResolvedValue({});
});

describe("runToolDescriptionRewrite - provider sentinel", () => {
  it("does not store the outage text as a draft", async () => {
    mockChat.mockResolvedValue({
      content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
      provider: "emergency",
      model: "none",
    });
    const res = await runToolDescriptionRewrite();
    expect(mem.upsert).not.toHaveBeenCalled();
    expect(res.drafted).toEqual([]);
    expect(res.failed.join(" ")).toContain("provider_unavailable");
  });

  it("control: a real draft is stored", async () => {
    mockChat.mockResolvedValue({
      content: "Look up one customer by exact name or phone; returns null when absent.",
      provider: "ollama",
      model: "m",
    });
    const res = await runToolDescriptionRewrite();
    expect(res.drafted).toEqual(["findCustomer"]);
    expect(mem.upsert).toHaveBeenCalledTimes(1);
  });
});
