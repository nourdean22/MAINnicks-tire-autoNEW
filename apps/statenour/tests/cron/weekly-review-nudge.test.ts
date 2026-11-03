/**
 * tests/cron/weekly-review-nudge.test.ts · R2a (2026-11-03)
 *
 * After the weekly review is written, ONE "Weekly review ready" push per ISO
 * week. The weekly_review_nudge marker is the claim (claim-before-act rule 4):
 * create -> P2002 means another run already took this week, so it never
 * pushes. A push that reached nothing releases the claim (assert-the-consumer
 * rule 4: the marker says "delivered" only after the push said so).
 *
 * The cron fires Monday 03:00 UTC = Sunday 22:00/23:00 ET, so the week is the
 * ET week (the review row's Monday), never the UTC date's week.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma, mockGenerateText, mockSendPush } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockSendPush: vi.fn(),
  mockPrisma: {
    brainMemory: {
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
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

// Sunday 2026-11-08 23:00 ET (EST) = Monday 2026-11-09 04:00Z: the UTC date sits in ISO week 46,
// the ET Sunday (and the review row's Monday, 2026-11-02) in week 45.
const SUNDAY_NIGHT = new Date("2026-11-09T04:00:00Z");
const NEXT_SUNDAY_NIGHT = new Date("2026-11-16T04:00:00Z");
const PRIVATE_REVIEW = "WINS:\n- Planted private win\nMISSES:\n- none\nPATTERNS DETECTED:\n- steady\nRECOMMENDED FOCUS FOR NEXT WEEK:\n- keep going";
const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

const nudgeCreates = () =>
  mockPrisma.brainMemory.create.mock.calls.filter(
    (c) => (c[0] as { data: { category: string } }).data.category === "weekly_review_nudge",
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY_NIGHT);
  for (const m of [mockPrisma.brainMemory.findMany, mockPrisma.task.findMany, mockPrisma.commitment.findMany, mockPrisma.brainDump.findMany, mockPrisma.reflection.findMany]) {
    m.mockResolvedValue([]);
  }
  mockPrisma.brainMemory.upsert.mockResolvedValue({ id: "review-row" });
  mockPrisma.brainMemory.create.mockResolvedValue({ id: "nudge-1" });
  mockPrisma.brainMemory.deleteMany.mockResolvedValue({ count: 1 });
  mockGenerateText.mockResolvedValue({ text: PRIVATE_REVIEW, usage: { inputTokens: 1, outputTokens: 1 } });
  mockSendPush.mockResolvedValue({ sent: 1, failed: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("weekly-review · one 'Weekly review ready' push per ISO week", () => {
  it("claims the ET week's marker, then pushes once with no review text in it", async () => {
    const res = await call();
    expect(nudgeCreates()).toHaveLength(1);
    const data = (nudgeCreates()[0][0] as { data: Record<string, unknown> }).data;
    expect(data.key).toBe("2026-W45");
    expect(data.expiresAt).toBeUndefined();
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    const payload = mockSendPush.mock.calls[0][0] as { title: string; body: string; tag: string };
    expect(payload.title).toBe("Weekly review ready");
    expect(payload.tag).toBe("weekly-review-ready-2026-W45");
    expect(JSON.stringify(payload)).not.toContain("Planted private win");
    expect(res.nudge).toBe("sent");
  });

  it("two runs in one week = one push: the second create hits P2002 and never pushes", async () => {
    mockPrisma.brainMemory.create.mockResolvedValueOnce({ id: "nudge-1" }).mockRejectedValueOnce(p2002());
    await call();
    const second = await call();
    expect(nudgeCreates()).toHaveLength(2);
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(second.nudge).toBe("duplicate");
    expect(mockPrisma.brainMemory.deleteMany).not.toHaveBeenCalled();
  });

  it("a new week = a new marker and a new push", async () => {
    await call();
    vi.setSystemTime(NEXT_SUNDAY_NIGHT);
    await call();
    expect(nudgeCreates().map((c) => (c[0] as { data: { key: string } }).data.key)).toEqual(["2026-W45", "2026-W46"]);
    expect(mockSendPush).toHaveBeenCalledTimes(2);
  });

  it("the push call rejected = no marker: the claim is released by its id", async () => {
    mockSendPush.mockRejectedValueOnce(new Error("vapid down"));
    const res = await call();
    expect(mockPrisma.brainMemory.deleteMany).toHaveBeenCalledWith({
      where: { id: "nudge-1", category: "weekly_review_nudge", key: "2026-W45" },
    });
    expect(res.nudge).toBe("failed");
  });

  it("a push that reached no device releases the claim too, so a rerun can try again", async () => {
    mockSendPush.mockResolvedValueOnce({ sent: 0, failed: 0 });
    const res = await call();
    expect(mockPrisma.brainMemory.deleteMany).toHaveBeenCalledTimes(1);
    expect(res.nudge).toBe("failed");
  });

  it("a push held by quiet hours (deferred to the Pulse sheet) keeps the marker", async () => {
    mockSendPush.mockResolvedValueOnce({ sent: 0, failed: 0, deferred: 1 });
    const res = await call();
    expect(mockPrisma.brainMemory.deleteMany).not.toHaveBeenCalled();
    expect(res.nudge).toBe("sent");
  });

  it("a review that was never written claims nothing and pushes nothing", async () => {
    mockPrisma.brainMemory.upsert.mockRejectedValueOnce(new Error("db down"));
    const res = await call();
    expect(nudgeCreates()).toHaveLength(0);
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(res.nudge).toBe("skipped");
  });

  it("the marker category is never merged by the nightly consolidation (a merge would rewrite or soft-delete it)", () => {
    expect(CONSOLIDATION_EXCLUDE_CATEGORIES).toContain("weekly_review_nudge");
  });

  it("a marker create that fails for another reason does not push (fail closed: no claim, no push)", async () => {
    mockPrisma.brainMemory.create.mockRejectedValueOnce(new Error("connection reset"));
    const res = await call();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(res.nudge).toBe("failed");
  });
});
