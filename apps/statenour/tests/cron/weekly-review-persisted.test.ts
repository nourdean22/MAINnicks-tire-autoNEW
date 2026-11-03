/**
 * tests/cron/weekly-review-persisted.test.ts · R2a manager ruling (2026-11-03)
 *
 * The weekly-review cron fires Monday 03:00 UTC = Sunday ~22:00-23:00 ET. sendPush holds a medium push
 * from 21:00 to 07:00 ET (lib/notifications/push.ts quiet hours), so a night push never buzzed. The
 * "Weekly review is ready" line now rides the 05:00 ET morning brief (tests/inngest/morning-brief-delivery
 * .test.ts), and this route only REPORTS whether the review row landed. It must never push.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockGenerateText, mockSendPush } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockSendPush: vi.fn(),
  mockPrisma: {
    brainMemory: { findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    task: { findMany: vi.fn() },
    commitment: { findMany: vi.fn() },
    brainDump: { findMany: vi.fn() },
    reflection: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("ai", () => ({ generateText: mockGenerateText }));
vi.mock("@/lib/notifications/push", () => ({ sendPush: mockSendPush }));
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
import { CONSOLIDATION_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";

const req = new Request("http://test/api/cron/weekly-review");
const ctx = { params: Promise.resolve({}) };
const call = () => (GET as unknown as (r: Request, c: unknown) => Promise<Record<string, unknown>>)(req, ctx);

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of [mockPrisma.brainMemory.findMany, mockPrisma.task.findMany, mockPrisma.commitment.findMany, mockPrisma.brainDump.findMany, mockPrisma.reflection.findMany]) {
    m.mockResolvedValue([]);
  }
  mockPrisma.brainMemory.upsert.mockResolvedValue({ id: "review-row" });
  mockGenerateText.mockResolvedValue({ text: "WINS:\n- a\nMISSES:\n- b\nPATTERNS DETECTED:\n- c\nRECOMMENDED FOCUS FOR NEXT WEEK:\n- d", usage: {} });
});

describe("weekly-review · reports the review row, never pushes at night", () => {
  it("a written review reports persisted: true and sends no push and writes no marker", async () => {
    const res = await call();
    expect(res.persisted).toBe(true);
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockPrisma.brainMemory.create).not.toHaveBeenCalled();
  });

  it("a review whose upsert failed reports persisted: false (the morning brief then finds no row)", async () => {
    mockPrisma.brainMemory.upsert.mockRejectedValueOnce(new Error("db down"));
    const res = await call();
    expect(res.persisted).toBe(false);
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("the weekly_review_nudge marker category is never merged by the nightly consolidation", () => {
    expect(CONSOLIDATION_EXCLUDE_CATEGORIES).toContain("weekly_review_nudge");
  });
});
