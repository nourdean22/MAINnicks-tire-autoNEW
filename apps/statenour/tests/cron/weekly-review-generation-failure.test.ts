/**
 * tests/cron/weekly-review-generation-failure.test.ts
 * 2026-09-02 · the weekly-review cron must survive a provider failure.
 *
 * /system/health reported 27 failed of 291 runs, against 318 attempts — the
 * job almost never completed. Two causes, one line apart:
 *
 *   1 · it called getModelWithFallback(), whose name promised failure handling
 *       and whose body was `return getModel()`.
 *   2 · trusting that name, nobody wrapped generateText. Any provider error —
 *       a retired model id, a 402, a timeout — threw out of the handler.
 *
 * A cron has no user to press retry. Throwing loses the entire week's review
 * and surfaces only as a row nobody reads. The fix returns a NAMED failure so
 * the run stays legible and the next week tries again.
 *
 * This asserts the BEHAVIOUR — call it with a rejecting provider and see what
 * comes back — not the presence of a try block.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockPrisma: {
    brainMemory: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    task: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    commitment: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    brainDump: { findMany: vi.fn().mockResolvedValue([]) },
    reflection: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("ai", () => ({ generateText: mockGenerateText }));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));
vi.mock("@/lib/ai/provider", () => ({
  getModel: () => ({ id: "test-model" }),
  getActiveProviderInfo: () => ({ provider: "test-provider", modelId: "test-model" }),
}));
vi.mock("@/lib/ai/system-prompt", () => ({ buildSystemPrompt: async () => "system" }));
vi.mock("@/lib/ai/track", () => ({ trackGeneration: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ai/agent-trace", () => ({
  mintTraceId: () => "trace-test",
  recordTrace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => undefined }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { GET } from "@/app/api/cron/weekly-review/route";

const req = new Request("http://test/api/cron/weekly-review");
const ctx = { params: Promise.resolve({}) };
const call = () => (GET as unknown as (r: Request, c: unknown) => Promise<Record<string, unknown>>)(req, ctx);

describe("weekly-review · a provider failure is a named outcome, not a thrown run", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("does not throw when the model call rejects", async () => {
    mockGenerateText.mockRejectedValue(new Error("model deepseek-v4-pro not found"));
    await expect(call()).resolves.toBeDefined();
  });

  it("reports the failure by name, and carries the provider error", async () => {
    mockGenerateText.mockRejectedValue(new Error("model deepseek-v4-pro not found"));
    const res = await call();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("generation_failed");
    expect(String(res.error)).toContain("deepseek-v4-pro");
    // The week is still identified, so the row on /system/health says WHICH
    // week was lost rather than only that something failed.
    expect(res.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("PLANTED POSITIVE · a succeeding run is NOT reported as failed", async () => {
    // Without this, a catch that swallowed everything — or a handler that
    // returned {ok:false} unconditionally — would pass the two tests above.
    mockGenerateText.mockResolvedValue({
      text: "WINS:\n- shipped\nMISSES:\n- none\nPATTERNS DETECTED:\n- steady\nRECOMMENDED FOCUS FOR NEXT WEEK:\n- keep going",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    const res = await call();
    expect(res.reason).toBeUndefined();
    expect(res.ok).not.toBe(false);
    expect(res.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
