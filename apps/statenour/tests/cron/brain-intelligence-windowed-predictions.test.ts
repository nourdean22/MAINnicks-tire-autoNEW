/**
 * brain-intelligence resolves clicks/revenue predictions on their STORED window.
 *
 * Before: the cron guessed the metric from words in the caption and read the bridge
 * for the day the prediction was CREATED, so "40 Google clicks tomorrow" was scored
 * against today's clicks. Now a row with a stored window is read for that window,
 * only after it has ended (ET), and a failed read stays unknown, never 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  findMany: vi.fn(),
  update: vi.fn(async () => ({})),
  queryNick: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { findMany: h.findMany, update: h.update } } }));
vi.mock("@/lib/nickstire/query", () => ({ queryNick: h.queryNick }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/brain/outcome-tracker", () => ({ scorePendingPredictions: vi.fn(async () => []) }));
vi.mock("@/lib/brain/counter-intuitive", () => ({ findCounterIntuitive: vi.fn(async () => []) }));
vi.mock("@/lib/brain/wisdom-distiller", () => ({ distillWisdom: vi.fn(async () => []) }));
vi.mock("@/lib/brain/learning-journal", () => ({ generateLearningJournal: vi.fn(async () => ({ date: "", selfAssessment: "" })) }));
vi.mock("@/lib/brain/blind-spot-detector", () => ({ detectBlindSpots: vi.fn(async () => []) }));
vi.mock("@/lib/brain/correlation-finder", () => ({ findCorrelations: vi.fn(async () => []) }));
vi.mock("@/lib/brain/teaching-moments", () => ({ findTeachingMoments: vi.fn(async () => []) }));
vi.mock("@/lib/brain/blind-spot-identity", () => ({ persistBlindSpot: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { GET } from "@/app/api/cron/brain-intelligence/route";

const run = () => GET(new Request("http://x/api/cron/brain-intelligence"), {} as never) as Promise<Record<string, unknown>>;

function row(id: string, createdAt: string, caption: string, predictions: unknown[]) {
  return {
    id,
    createdAt: new Date(createdAt),
    content: `[unresolved] on caption: "${caption}"`,
    metadata: { predictions, captionPreview: caption, captionHash: `h-${id}`, resolved: false },
  };
}
const ok = (data: Record<string, unknown>) => ({ data, query: "q", timestamp: "t" });
const metaWrites = () =>
  h.update.mock.calls.map(([a]) => (a as { where: { id: string }; data: { metadata: Record<string, unknown> } }));

beforeEach(() => {
  h.rows = [];
  h.findMany.mockReset();
  h.findMany.mockImplementation(async (args: { where?: { id?: string } }) =>
    args?.where?.id ? h.rows.filter((r) => r.id === args.where!.id) : h.rows,
  );
  h.update.mockClear();
  h.queryNick.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  // Tue 2026-10-20 21:00 EDT.
  vi.setSystemTime(new Date("2026-10-21T01:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("brain-intelligence - windowed clicks/revenue predictions", () => {
  it("reads revenue for the stored window, not the creation day and not a word guess", async () => {
    // The caption says "click": the old word guess would have read GSC for the creation day.
    h.rows = [row("r1", "2026-10-13T14:00:00Z", "click the link - sales should hit $1,000 this week",
      [{ metric: "revenue", value: 1000, rawMatch: "x", window: { from: "2026-10-11", to: "2026-10-17" } }])];
    h.queryNick.mockResolvedValue(ok({ totalDollars: 1100 }));

    await run();

    expect(h.queryNick).toHaveBeenCalledTimes(1);
    expect(h.queryNick).toHaveBeenCalledWith("revenue_range", { from: "2026-10-11", to: "2026-10-17" });
    const [w] = metaWrites();
    expect(w.where.id).toBe("r1");
    expect(w.data.metadata).toMatchObject({ resolved: true, resolvedMetric: "revenue", actualScore: 1100 });
    expect(w.data.metadata.errorPct).toBeCloseTo(0.1, 5);
  });

  it("reads official GSC clicks for the stored window once it has settled", async () => {
    h.rows = [row("c1", "2026-10-13T14:00:00Z", "Expect 40 Google clicks tomorrow",
      [{ metric: "clicks", value: 40, rawMatch: "x", window: { from: "2026-10-14", to: "2026-10-14" } }])];
    h.queryNick.mockResolvedValue(ok({ totalClicks: 44, source: "gsc_official_no_dimension" }));

    await run();

    expect(h.queryNick).toHaveBeenCalledWith("gsc_summary", { from: "2026-10-14", to: "2026-10-14" });
    expect(metaWrites()[0].data.metadata).toMatchObject({ resolved: true, resolvedMetric: "clicks", actualScore: 44 });
  });

  it("the pending query asks the DB for unresolved rows only, so resolved rows cannot fill the 100-row window", async () => {
    await run();
    const where = (h.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.metadata).toEqual({ path: ["resolved"], equals: false });
  });

  it("a window still open (ET) stays pending: no read, no write", async () => {
    h.rows = [row("o1", "2026-10-19T14:00:00Z", "Sales should hit $5,000 this week",
      [{ metric: "revenue", value: 5000, rawMatch: "x", window: { from: "2026-10-18", to: "2026-10-24" } }])];

    await run();

    expect(h.queryNick).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("a window that ends today (ET) is still open", async () => {
    h.rows = [row("o2", "2026-10-19T14:00:00Z", "Revenue should be $900 today",
      [{ metric: "revenue", value: 900, rawMatch: "x", window: { from: "2026-10-20", to: "2026-10-20" } }])];

    await run();

    expect(h.queryNick).not.toHaveBeenCalled();
  });

  it("clicks inside GSC's data lag stay pending", async () => {
    h.rows = [row("l1", "2026-10-18T14:00:00Z", "Expect 40 Google clicks tomorrow",
      [{ metric: "clicks", value: 40, rawMatch: "x", window: { from: "2026-10-19", to: "2026-10-19" } }])];

    await run();

    expect(h.queryNick).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("a failed bridge read writes nothing (never a 0)", async () => {
    h.rows = [row("f1", "2026-10-13T14:00:00Z", "Sales should hit $1,000 this week",
      [{ metric: "revenue", value: 1000, rawMatch: "x", window: { from: "2026-10-11", to: "2026-10-17" } }])];
    h.queryNick.mockResolvedValue({ error: "bridge down", statusCode: 502 });

    await run();

    expect(h.queryNick).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("partial GSC rows (inside the lag) are unknown, not a measurement", async () => {
    h.rows = [row("p1", "2026-10-13T14:00:00Z", "Expect 40 Google clicks tomorrow",
      [{ metric: "clicks", value: 40, rawMatch: "x", window: { from: "2026-10-14", to: "2026-10-14" } }])];
    h.queryNick.mockResolvedValue(ok({ totalClicks: 3, source: "stored_query_rows_partial" }));

    await run();

    expect(h.update).not.toHaveBeenCalled();
  });

  it("a read still failing 7+ days after the window settled expires as unverifiable, with no actualScore", async () => {
    h.rows = [row("e1", "2026-09-20T14:00:00Z", "Sales should hit $1,000 this week",
      [{ metric: "revenue", value: 1000, rawMatch: "x", window: { from: "2026-09-20", to: "2026-09-26" } }])];
    h.queryNick.mockResolvedValue({ error: "bridge down" });

    await run();

    const [w] = metaWrites();
    expect(w.data.metadata).toMatchObject({ resolved: true, resolvedOutcome: "expired_unverifiable" });
    expect(w.data.metadata).not.toHaveProperty("actualScore");
  });
});

describe("brain-intelligence - rows without a window keep the old path (CONTROL)", () => {
  it("a legacy clicks-worded row still reads GSC for its creation day", async () => {
    h.rows = [row("g1", "2026-10-18T15:00:00Z", "more search clicks soon", [{ metric: "engagement", value: 200, rawMatch: "x" }])];
    h.queryNick.mockResolvedValue(ok({ totalClicks: 12 }));

    await run();

    expect(h.queryNick).toHaveBeenCalledWith("gsc_summary", { from: "2026-10-18", to: "2026-10-18" });
  });

  it("a stale engagement-only row still expires as unverifiable", async () => {
    h.rows = [row("x1", "2026-10-01T15:00:00Z", "this one hits 300 engagement", [{ metric: "engagement", value: 300, rawMatch: "x" }])];

    await run();

    expect(h.queryNick).not.toHaveBeenCalled();
    expect(metaWrites()[0].data.metadata).toMatchObject({ resolved: true, resolvedOutcome: "expired_unverifiable" });
  });
});
