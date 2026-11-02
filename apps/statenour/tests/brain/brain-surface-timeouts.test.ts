/**
 * Upgrade 5 (background brains finish), 2026-11-01. Each off-peak brain surface carries its
 * own model ceiling, sized from Langfuse prod spans over 7 days (all at 03:00Z):
 *   session-distiller     fast lane, 37 of 70 aborted at 45.0 s, ok p99 44.5 s  -> 90 s
 *   memory-consolidation  reason, 29 of 349 aborted at 100.0 s, ok max 99.1 s   -> 180 s
 *   thinking-engine       reason, 14 of 21 aborted at 100.0 s, ok p90 98.9 s    -> 180 s
 * The chat-reachable thinking-engine call (runSimulation, a chat tool) keeps the default:
 * a longer ceiling there would hold a chat turn open.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  factoryCalls: [] as Array<{ label: string; defaults: unknown }>,
  aiChat: vi.fn(),
  tracedAiChat: vi.fn(),
  aiChatRaw: vi.fn(),
}));

describe("tracedAiChat · forwards timeoutMs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/ai/traced-aichat");
    vi.doMock("@/lib/ai/provider", () => ({ aiChat: mocks.aiChatRaw }));
    vi.doMock("@/lib/ai/budget", () => ({
      assertWithinBudget: vi.fn().mockResolvedValue({ ok: true, status: { percentUsed: 0 } }),
      BudgetExceededError: class extends Error {},
    }));
    vi.doMock("@/lib/prisma", () => ({ prisma: { agentTrace: { create: vi.fn().mockResolvedValue({}) } } }));
    mocks.aiChatRaw.mockReset().mockResolvedValue({ content: "ok", provider: "ollama", model: "m" });
  });

  it("a factory default reaches aiChat", async () => {
    const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
    await makeTracedAiChat("x", "brain", { timeoutMs: 90_000 })([{ role: "user", content: "q" }], "fast");
    expect(mocks.aiChatRaw.mock.calls[0][2].timeoutMs).toBe(90_000);
  });

  it("a per-call value wins over the factory default", async () => {
    const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
    await makeTracedAiChat("x", "brain", { timeoutMs: 90_000 })([{ role: "user", content: "q" }], "fast", { timeoutMs: 5_000 });
    expect(mocks.aiChatRaw.mock.calls[0][2].timeoutMs).toBe(5_000);
  });

  it("a call site passing timeoutMs: undefined keeps the factory default", async () => {
    const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
    await makeTracedAiChat("x", "brain", { timeoutMs: 90_000 })([{ role: "user", content: "q" }], "fast", { timeoutMs: undefined });
    expect(mocks.aiChatRaw.mock.calls[0][2].timeoutMs).toBe(90_000);
  });

  it("CONTROL: no default leaves timeoutMs unset (chat callers keep the provider default)", async () => {
    const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
    await makeTracedAiChat("x")([{ role: "user", content: "q" }], "fast");
    expect(mocks.aiChatRaw.mock.calls[0][2].timeoutMs).toBeUndefined();
  });
});

describe("brain surfaces · measured ceilings", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.factoryCalls.length = 0;
    vi.doMock("@/lib/ai/traced-aichat", () => ({
      makeTracedAiChat: (label: string, _source?: string, defaults?: unknown) => {
        mocks.factoryCalls.push({ label, defaults });
        return mocks.aiChat;
      },
    }));
  });

  it("session-distiller gets 90 s", async () => {
    await import("@/lib/brain/session-distiller");
    const call = mocks.factoryCalls.find((c) => c.label === "session-distiller");
    expect(call?.defaults).toEqual({ timeoutMs: 90_000 });
  });

  it("memory-consolidation gets 180 s", async () => {
    await import("@/lib/brain/memory-consolidation");
    const call = mocks.factoryCalls.find((c) => c.label === "memory-consolidation");
    expect(call?.defaults).toEqual({ timeoutMs: 180_000 });
  });
});

describe("thinking-engine · cron layers get 180 s, the chat tool does not", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.aiChat.mockReset().mockResolvedValue({ content: "[]", provider: "ollama" });
    vi.doMock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => mocks.aiChat }));
    const empty = vi.fn().mockResolvedValue([]);
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        contradiction: { findMany: empty, create: vi.fn() },
        commitment: { findMany: empty },
        brainDump: { findMany: empty },
        brainMemory: { findMany: empty },
        reflection: { findMany: empty },
        masteryDecision: { findMany: empty },
        patternDetection: { findMany: empty },
        prediction: { findMany: empty },
        causalChain: { findMany: empty, create: vi.fn() },
        financialSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
        identitySnapshot: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
        simulation: { create: vi.fn().mockResolvedValue({ id: "s" }) },
      },
    }));
    vi.doMock("@/lib/brain/legacy-shims", () => ({
      recentScoreSnapshots: empty,
      recentDailyHabits: empty,
      recentShopJobs: empty,
      recentShopLeads: empty,
      recentShopQuotes: empty,
    }));
    vi.doMock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
    vi.doMock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
    vi.doMock("@/lib/nickstire/query", () => ({ queryNick: vi.fn(), queryNickBatch: vi.fn() }));
  });

  it("detectContradictions passes 180 s", async () => {
    const { detectContradictions } = await import("@/lib/brain/thinking-engine");
    await detectContradictions();
    expect(mocks.aiChat.mock.calls[0][2]).toEqual({ timeoutMs: 180_000 });
  });

  it("trackIdentityEvolution passes 180 s", async () => {
    const { trackIdentityEvolution } = await import("@/lib/brain/thinking-engine");
    await trackIdentityEvolution();
    expect(mocks.aiChat.mock.calls[0][2]).toEqual({ timeoutMs: 180_000 });
  });

  it("analyzeCausalChains passes 180 s", async () => {
    const { analyzeCausalChains } = await import("@/lib/brain/thinking-engine");
    await analyzeCausalChains();
    expect(mocks.aiChat.mock.calls[0]?.[2]).toEqual({ timeoutMs: 180_000 });
  });

  it("CONTROL: runSimulation (a chat tool) keeps the provider default", async () => {
    const { runSimulation } = await import("@/lib/brain/thinking-engine");
    await runSimulation("what if");
    expect(mocks.aiChat).toHaveBeenCalled();
    expect(mocks.aiChat.mock.calls[0][2]).toBeUndefined();
  });
});
