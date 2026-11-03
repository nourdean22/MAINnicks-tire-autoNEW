/**
 * R2b (job 2026-11-02-nour-os-interconnect, 2026-11-03): an active business goal that names a shop metric
 * (revenue or cars) gets its currentValue set nightly from the shop through the bridge, as a VALUE only: one
 * progress_logged GoalEvent with source shop-bridge, never a check-in (a check-in would turn "check-in due"
 * green without Nour looking). A failed, slow or empty read skips the goal and says why; it never writes 0.
 *
 * The real updateGoal runs (lib/services/goals.ts) over a faked Prisma client, so the write and the event
 * it emits are what is asserted, not a call into a mock of the writer.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Goal = {
  id: string;
  domain: string;
  metric: string;
  kind: string;
  status: string;
  title: string;
  currentValue: number;
  targetValue: number;
  horizon: string | null;
  deadline: Date | null;
  createdAt: Date;
};

const h = vi.hoisted(() => ({
  goals: [] as unknown[],
  queryNick: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  goalEventCreate: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.findMany, findUnique: h.findUnique, update: h.update },
    goalEvent: { create: h.goalEventCreate },
  },
}));
vi.mock("@/lib/nickstire/query", async (orig) => ({
  ...(await orig<typeof import("@/lib/nickstire/query")>()),
  queryNick: h.queryNick,
}));
vi.mock("@/lib/brain/goal-events", () => ({ emitGoalEventAsync: h.emit }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitGoalTransition: vi.fn() }));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: (x: unknown) => x }));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (handler: (req: Request, ctx: unknown) => Promise<unknown>) => handler,
}));

import { GET } from "@/app/api/cron/goal-shop-sync/route";
import { goalShopWindow, SHOP_SYNC_SOURCE } from "@/lib/services/goal-shop-sync";
import { SHOP_READ_DEADLINE_MS } from "@/lib/home/shop-today";
import { CRONS } from "@/config/crons";
import { EVENING_JOBS, OFFPEAK_BRAIN_JOBS } from "@/lib/inngest/jobs";
import { deriveDegradation } from "@/lib/inngest/cron-lifecycle";

type Result = {
  synced: Array<{ goalId: string; metric: string; value: number }>;
  skipped: Array<{ goalId: string; reason: string }>;
  failed: Array<{ goalId: string; reason: string }>;
  resultCount: number;
};
const run = () =>
  (GET as unknown as (req: Request, ctx: unknown) => Promise<Result>)(new Request("http://test/api/cron/goal-shop-sync"), {
    params: Promise.resolve({}),
  });

// 03:00Z on 2026-11-04 is 22:00 EST on 2026-11-03: the evening fan-out runs after the shop's day.
const NOW = new Date("2026-11-04T03:00:00.000Z");

const goal = (over: Partial<Goal>): Goal => ({
  id: "g",
  domain: "business",
  metric: "revenue",
  kind: "metric",
  status: "active",
  title: "Shop goal",
  currentValue: 0,
  targetValue: 100_000,
  horizon: null,
  deadline: null,
  createdAt: new Date("2026-10-20T14:00:00.000Z"),
  ...over,
});

// MONTH goal created 2026-11-02: its period is November, read through today (2026-11-03).
const REVENUE = goal({ id: "g_rev", metric: "revenue", horizon: "MONTH", currentValue: 1000, targetValue: 15_000, createdAt: new Date("2026-11-02T15:00:00.000Z") });
// No horizon, no deadline: from its creation day (2026-10-20) through today.
const CARS = goal({ id: "g_cars", metric: "Cars", currentValue: 40, targetValue: 400 });
const REVIEWS = goal({ id: "g_reviews", metric: "reviews", currentValue: 300, targetValue: 400 });
const NOT_SHOP = goal({ id: "g_savings", metric: "savings_balance", currentValue: 5000, targetValue: 20_000 });

const answer = (data: unknown) => ({ data, query: "revenue_range", timestamp: NOW.toISOString() });
const RANGE: Record<string, unknown> = {
  "2026-11-01|2026-11-03": { from: "2026-11-01", to: "2026-11-03", totalDollars: 4210.254, invoiceCount: 11, avgTicket: 382.77 },
  "2026-10-20|2026-11-03": { from: "2026-10-20", to: "2026-11-03", totalDollars: 31_250, invoiceCount: 77, avgTicket: 405.84 },
};
const bridgeAnswers = () =>
  h.queryNick.mockImplementation(async (_q: string, f: { from: string; to: string }) => answer(RANGE[`${f.from}|${f.to}`] ?? { error: "no fixture" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  for (const m of [h.queryNick, h.findMany, h.findUnique, h.update, h.goalEventCreate, h.emit]) m.mockReset();
  h.goals = [REVENUE, CARS, REVIEWS, NOT_SHOP];
  h.findMany.mockImplementation(async () => h.goals);
  h.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (h.goals as Goal[]).find((g) => g.id === where.id) ?? null);
  h.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    ...(h.goals as Goal[]).find((g) => g.id === where.id),
    ...data,
  }));
  bridgeAnswers();
});
afterEach(() => vi.useRealTimers());

const writes = () => h.update.mock.calls.map((c) => c[0] as { where: { id: string }; data: Record<string, unknown> });
const events = () => h.emit.mock.calls.map((c) => c[0] as { goalId: string; kind: string; source: string; payload?: Record<string, unknown> });

describe("cron/goal-shop-sync · the value comes from the shop", () => {
  it("reads only active, live, metric business goals", async () => {
    await run();
    const where = (h.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ status: "active", deletedAt: null, kind: "metric", domain: { equals: "business", mode: "insensitive" } });
  });

  it("sets revenue from revenue_range totalDollars and cars from its invoiceCount, over each goal's ET window", async () => {
    const out = await run();
    expect(h.queryNick).toHaveBeenCalledWith("revenue_range", { from: "2026-11-01", to: "2026-11-03" }, SHOP_READ_DEADLINE_MS);
    expect(h.queryNick).toHaveBeenCalledWith("revenue_range", { from: "2026-10-20", to: "2026-11-03" }, SHOP_READ_DEADLINE_MS);
    expect(writes()).toEqual([
      expect.objectContaining({ where: { id: "g_rev" }, data: expect.objectContaining({ currentValue: 4210.25 }) }),
      expect.objectContaining({ where: { id: "g_cars" }, data: expect.objectContaining({ currentValue: 77 }) }),
    ]);
    expect(out.synced).toEqual([
      { goalId: "g_rev", metric: "revenue", value: 4210.25 },
      { goalId: "g_cars", metric: "cars", value: 77 },
    ]);
    expect(out.resultCount).toBe(2);
  });

  it("each write is one progress_logged event, source shop-bridge, carrying the window and the raw read", async () => {
    await run();
    expect(SHOP_SYNC_SOURCE).toBe("shop-bridge");
    const rev = events().filter((e) => e.goalId === "g_rev");
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({
      kind: "progress_logged",
      source: "shop-bridge",
      payload: {
        before: 1000,
        after: 4210.25,
        delta: 3210.25,
        window: { from: "2026-11-01", to: "2026-11-03" },
        read: { query: "revenue_range", totalDollars: 4210.254, invoiceCount: 11 },
      },
    });
  });

  it("never writes a check-in: no check_in event, and no GoalEvent row written directly", async () => {
    await run();
    expect(events().length).toBeGreaterThan(0);
    expect(events().filter((e) => e.kind === "check_in")).toEqual([]);
    expect(events().every((e) => e.kind === "progress_logged" && e.source === "shop-bridge")).toBe(true);
    expect(h.goalEventCreate).not.toHaveBeenCalled();
  });

  it("a goal whose metric is not a shop metric is untouched and costs no bridge read", async () => {
    h.goals = [NOT_SHOP];
    const out = await run();
    expect(h.queryNick).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([]);
  });

  it("a reviews goal is skipped with its reason: the stored Places sample is not the shop's review total", async () => {
    h.goals = [REVIEWS];
    const out = await run();
    expect(h.update).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([{ goalId: "g_reviews", reason: expect.stringMatching(/review total/) }]);
  });

  it("a value unchanged since the last sync writes nothing", async () => {
    h.goals = [{ ...CARS, currentValue: 77 }];
    const out = await run();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([{ goalId: "g_cars", reason: "unchanged" }]);
  });
});

describe("cron/goal-shop-sync · a failed read is never a zero", () => {
  it("a bridge error skips the goal as bridge unavailable and writes nothing", async () => {
    h.queryNick.mockResolvedValue({ error: "fetch failed" });
    const out = await run();
    expect(h.update).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([
      { goalId: "g_rev", reason: expect.stringMatching(/^skipped: bridge unavailable/) },
      { goalId: "g_cars", reason: expect.stringMatching(/^skipped: bridge unavailable/) },
      { goalId: "g_reviews", reason: expect.stringMatching(/review total/) },
    ]);
  });

  it("a bridge miss files the run partial with its reason (the consumer: cron-lifecycle deriveDegradation)", async () => {
    h.queryNick.mockResolvedValue({ error: "fetch failed" });
    const out = await run();
    expect(deriveDegradation(out)).toEqual({ degraded: true, reason: expect.stringMatching(/^2 goal\(s\) bridge unavailable, 0 write\(s\) failed: skipped: bridge unavailable \(fetch failed\)/) });
  });

  it("control: a clean run, and an unchanged or reviews skip, is not degraded", async () => {
    const out = await run();
    expect(deriveDegradation(out)).toEqual({ degraded: false, reason: null });
  });

  it("a rejected fetch (the guard's planted failure) writes nothing", async () => {
    h.queryNick.mockRejectedValue(new Error("ECONNRESET"));
    const out = await run();
    expect(h.update).not.toHaveBeenCalled();
    expect(out.skipped.filter((s) => s.reason.startsWith("skipped: bridge unavailable"))).toHaveLength(2);
  });

  it("a handler error inside a 200 (No DB) is unknown, not zero", async () => {
    h.queryNick.mockResolvedValue(answer({ error: "No DB" }));
    await run();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("a shop that does not answer within the Home deadline is skipped, not waited on", async () => {
    h.goals = [REVENUE];
    h.queryNick.mockImplementation(() => new Promise(() => {}));
    const p = run();
    await vi.advanceTimersByTimeAsync(SHOP_READ_DEADLINE_MS);
    const out = await p;
    expect(h.update).not.toHaveBeenCalled();
    expect(out.skipped).toEqual([{ goalId: "g_rev", reason: expect.stringMatching(/^skipped: bridge unavailable.*3 s/) }]);
  });

  it("an empty window (no invoices) skips rather than writing 0", async () => {
    h.queryNick.mockResolvedValue(answer({ totalDollars: 0, invoiceCount: 0, avgTicket: 0 }));
    const out = await run();
    expect(h.update).not.toHaveBeenCalled();
    expect(out.skipped.filter((s) => /no invoices/.test(s.reason))).toHaveLength(2);
  });

  it("an answer with no number skips", async () => {
    h.queryNick.mockResolvedValue(answer({ from: "x", to: "y" }));
    await run();
    expect(h.update).not.toHaveBeenCalled();
  });

  it("one goal's failed write does not stop the next, and is reported as failed", async () => {
    h.update.mockRejectedValueOnce(new Error("neon: connection terminated"));
    const out = await run();
    expect(out.failed).toEqual([{ goalId: "g_rev", reason: expect.stringMatching(/connection terminated/) }]);
    expect(out.synced.map((s) => s.goalId)).toEqual(["g_cars"]);
  });
});

describe("goalShopWindow · ET shop days", () => {
  it("a MONTH goal reads its calendar month, through today", () => {
    expect(goalShopWindow(REVENUE, NOW)).toEqual({ from: "2026-11-01", to: "2026-11-03" });
  });
  it("a WEEK goal from a past week reads that Mon-Sun week only", () => {
    // Created Wed 2026-10-28 ET: the week is Mon 10-26 .. Sun 11-01.
    expect(goalShopWindow(goal({ horizon: "WEEK", createdAt: new Date("2026-10-28T16:00:00.000Z") }), NOW)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });
  it("a goal with a deadline reads from its creation day to the deadline", () => {
    expect(goalShopWindow(goal({ deadline: new Date("2026-10-31T16:00:00.000Z") }), NOW)).toEqual({ from: "2026-10-20", to: "2026-10-31" });
  });
  it("a goal created late in the evening ET counts from its ET day, not the UTC day", () => {
    // 2026-11-03T02:30Z is 21:30 EST on 2026-11-02.
    expect(goalShopWindow(goal({ createdAt: new Date("2026-11-03T02:30:00.000Z") }), NOW)).toEqual({ from: "2026-11-02", to: "2026-11-03" });
  });
  it("a deadline before the creation day is no window", () => {
    expect(goalShopWindow(goal({ deadline: new Date("2026-10-01T16:00:00.000Z") }), NOW)).toBeNull();
  });
});

describe("cron/goal-shop-sync · wiring (the scheduler reaches it)", () => {
  it("is folded into mega-evening, in EVENING_JOBS, dispatched in the 03:00Z batch, and has a route file", () => {
    const entry = CRONS.find((c) => c.name === "goal-shop-sync");
    expect(entry, "no manifest entry").toBeDefined();
    expect(entry!.mode).toBe("folded");
    expect(entry!.foldedInto).toBe("mega-evening");
    expect(entry!.description).toMatch(/never a check-in/);
    expect(EVENING_JOBS).toContain("/api/cron/goal-shop-sync");
    // mega-fanout's evening batch dispatches EVENING_JOBS minus the off-peak brain set.
    expect(OFFPEAK_BRAIN_JOBS).not.toContain("/api/cron/goal-shop-sync");
    expect(fs.existsSync(path.resolve(__dirname, "../../app/api/cron/goal-shop-sync/route.ts"))).toBe(true);
  });
});
