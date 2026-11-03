/**
 * tests/cron/weekly-review-persisted.test.ts · R2a manager ruling (2026-11-03)
 *
 * The weekly-review cron fires Monday 03:00 UTC = Sunday ~22:00-23:00 ET. sendPush holds a medium push
 * from 21:00 to 07:00 ET (lib/notifications/push.ts quiet hours), so a night push never buzzed. The
 * "Weekly review is ready" line now rides the 05:00 ET morning brief (tests/inngest/morning-brief-delivery
 * .test.ts), and this route only REPORTS whether the review row landed. It must never push.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma, mockGenerateText, mockSendPush, mockLogError } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockSendPush: vi.fn(),
  mockLogError: vi.fn(),
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
vi.mock("@/lib/utils/error-log", () => ({ logError: mockLogError }));
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

  it("F2 · a review whose upsert failed is a FAILED run (ok: false, named), logged through logError", async () => {
    mockPrisma.brainMemory.upsert.mockRejectedValueOnce(new Error("db down"));
    const res = await call();
    expect(res).toMatchObject({ ok: false, persisted: false, reason: "persist_failed" });
    expect(mockLogError).toHaveBeenCalledWith("cron/weekly-review", expect.anything(), expect.objectContaining({ stage: "persist" }));
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it("F1(d) · a rerun revives its own week: the update branch clears deletedAt", async () => {
    await call();
    const update = (mockPrisma.brainMemory.upsert.mock.calls[0][0] as { update: Record<string, unknown> }).update;
    expect(update).toHaveProperty("deletedAt", null);
  });
});

describe("weekly-review · the key it writes is the week being REVIEWED (G3 + late fire)", () => {
  afterEach(() => vi.useRealTimers());
  const writtenKey = () =>
    (mockPrisma.brainMemory.upsert.mock.calls[0][0] as { where: { category_key: { key: string } } }).where.category_key.key;
  const cases: Array<[string, string, string]> = [
    ["on time, EST", "2026-11-09T03:00:00Z", "weekly:2026-11-02"],
    ["on time, the fall-back Sunday 2026-11-01", "2026-11-02T03:00:00Z", "weekly:2026-10-26"],
    ["on time, EDT", "2026-10-26T03:00:00Z", "weekly:2026-10-19"],
    ["on time, the spring-forward Sunday 2027-03-14", "2027-03-15T03:00:00Z", "weekly:2027-03-08"],
    ["late fire after midnight EDT (same key as on time)", "2026-10-26T04:30:00Z", "weekly:2026-10-19"],
    ["late fire after midnight EST (same key as on time)", "2026-11-09T06:30:00Z", "weekly:2026-11-02"],
  ];
  for (const [label, at, want] of cases) {
    it(`${label}: ${at} -> ${want}`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(at));
      await call();
      expect(writtenKey()).toBe(want);
    });
  }

  it("the weekly_review_nudge marker category is never merged by the nightly consolidation", () => {
    expect(CONSOLIDATION_EXCLUDE_CATEGORIES).toContain("weekly_review_nudge");
  });
});
