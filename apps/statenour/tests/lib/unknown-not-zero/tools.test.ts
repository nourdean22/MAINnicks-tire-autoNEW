/**
 * Unknown is not zero: Nick's tools (audit 2026-10-10, 08-F6 section 3, 03-F1).
 *
 * setMit/clearMit must persist (they returned a dead clientAction and told the operator
 * "MIT set... Locked until midnight"). suggestMIT / dailyPulse / endOfDay / weeklyReview /
 * findCustomer must say "unknown" when a read fails, never "All clear", 0, or "no customer".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const mem = new Map<string, { content: string; deletedAt: Date | null; updatedAt: Date }>();
  return {
    mem,
    queryNick: vi.fn(),
    queryNickBatch: vi.fn(),
    fetchShopSnapshot: vi.fn(),
    getUnresolvedAlerts: vi.fn(),
    db: {} as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
  };
});

vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge,
  queryNick: h.queryNick,
  queryNickBatch: h.queryNickBatch,
}));
vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/services/bridge", () => ({ fetchShopSnapshot: h.fetchShopSnapshot }));
vi.mock("@/lib/mastery/drift-engine", () => ({ getUnresolvedAlerts: h.getUnresolvedAlerts }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { tasksTools } from "@/lib/ai/tools/tasks";
import { habitsTools } from "@/lib/ai/tools/habits";
import { businessTools } from "@/lib/ai/tools/business";
import { getMit } from "@/lib/services/mit";

type Exec = { execute: (args: unknown, opts?: unknown) => Promise<unknown> };
const run = (t: unknown, args: unknown = {}) => (t as Exec).execute(args, {});
const FORBIDDEN = /All clear|NO LEADS|No stale|no customer matched/;

const SOFT_ERROR = { query: "x", timestamp: "t", data: { error: "No DB" } };

function resetDb() {
  h.mem.clear();
  for (const k of Object.keys(h.db)) delete h.db[k];
  Object.assign(h.db, {
    brainMemory: {
      upsert: vi.fn(async (a: { where: { category_key: { key: string } }; create: { content: string }; update: { content: string } }) => {
        const key = a.where.category_key.key;
        const row = { content: h.mem.has(key) ? a.update.content : a.create.content, deletedAt: null, updatedAt: new Date() };
        h.mem.set(key, row);
        return row;
      }),
      findFirst: vi.fn(async (a: { where: { key: string } }) => {
        const row = h.mem.get(a.where.key);
        return row && !row.deletedAt ? row : null;
      }),
      updateMany: vi.fn(async (a: { where: { key: string } }) => {
        const row = h.mem.get(a.where.key);
        if (row) row.deletedAt = new Date();
        return { count: row ? 1 : 0 };
      }),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    task: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    commitment: { findMany: vi.fn(async () => []) },
    personProfile: { findFirst: vi.fn(async () => null) },
  });
}

beforeEach(() => {
  resetDb();
  h.queryNick.mockReset();
  h.queryNickBatch.mockReset();
  h.fetchShopSnapshot.mockReset();
  h.getUnresolvedAlerts.mockReset().mockResolvedValue([]);
});

describe("setMit / clearMit persist (03-F1)", () => {
  it("setMit writes today's MIT: getMit() returns the text", async () => {
    const out = (await run(tasksTools.setMit, { text: "  Close the Smith estimate  " })) as Record<string, unknown>;
    expect((await getMit()).text).toBe("Close the Smith estimate");
    expect(out).not.toHaveProperty("clientAction");
  });

  it("clearMit clears it", async () => {
    await run(tasksTools.setMit, { text: "Call Mike" });
    await run(tasksTools.clearMit, {});
    expect((await getMit()).text).toBeNull();
  });

  it("a failed write is reported as failed, not 'MIT set'", async () => {
    h.db.brainMemory.upsert.mockRejectedValue(new Error("db down"));
    const out = JSON.stringify(await run(tasksTools.setMit, { text: "Call Mike" }));
    expect(out).not.toContain("MIT set");
    expect(out).toMatch(/not saved|failed/i);
  });
});

describe("dailyPulse / endOfDay", () => {
  const batchOf = (v: unknown) => async (qs: Array<{ query: string }>) => Object.fromEntries(qs.map((q) => [q.query, v]));

  it("dailyPulse: a failed shop read is unknown, and a failed task read is not an empty list", async () => {
    h.queryNickBatch.mockImplementation(batchOf(SOFT_ERROR));
    h.db.task.findMany.mockRejectedValue(new Error("db down"));
    const out = (await run(tasksTools.dailyPulse)) as Record<string, unknown>;
    const s = JSON.stringify(out);
    expect((out.shop as Record<string, unknown>).revenue_today).toMatchObject({ status: "unknown" });
    expect(s).not.toContain('"tasks":[]');
    expect(s).toContain("unknown");
  });

  // 2026-11-01 · "is the shop open Sunday?" had no tool to answer from: the chat rule sends shop hours
  // to a tool result, and dailyPulse carries them now (computed, so a failed shop read cannot hide them).
  it("dailyPulse carries the shop's weekly hours and openNow, even when the shop read failed", async () => {
    h.queryNickBatch.mockImplementation(batchOf(SOFT_ERROR));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-01T14:00:00Z")); // Sunday 09:00 EST, the DST fall-back day
      const out = (await run(tasksTools.dailyPulse)) as { shopHours: { openNow: boolean; weekly: Record<string, string>; today: { weekday: string } } };
      expect(out.shopHours.openNow).toBe(true);
      expect(out.shopHours.today.weekday).toBe("sunday");
      expect(out.shopHours.weekly.sunday).toBe("09:00-16:00");
      vi.setSystemTime(new Date("2026-11-01T21:00:00Z")); // Sunday 16:00 EST: closed
      expect(((await run(tasksTools.dailyPulse)) as { shopHours: { openNow: boolean } }).shopHours.openNow).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("endOfDay: failed task counts are unknown, not 0", async () => {
    h.queryNickBatch.mockImplementation(batchOf({ error: "fetch failed" }));
    h.db.task.findMany.mockRejectedValue(new Error("db down"));
    const out = (await run(tasksTools.endOfDay)) as { personal: Record<string, unknown>; shop: Record<string, unknown> };
    expect(out.personal.tasksCompleted).toMatch(/unknown/);
    expect(out.personal.tasksRemaining).toMatch(/unknown/);
    expect(out.shop.revenue_today).toMatchObject({ status: "unknown" });
  });

  it("CONTROL: successful empty reads stay real values", async () => {
    h.queryNickBatch.mockImplementation(batchOf({ data: { count: 0 } }));
    const out = (await run(tasksTools.endOfDay)) as { personal: Record<string, unknown>; shop: Record<string, unknown> };
    expect(out.personal.tasksCompleted).toBe(0);
    expect(out.shop.revenue_today).toEqual({ count: 0 });
  });
});

describe("weeklyReview", () => {
  it("failed reads are unknown, not 0 / a 0% completion rate", async () => {
    h.queryNick.mockResolvedValue(SOFT_ERROR);
    h.db.task.count.mockRejectedValue(new Error("db down"));
    const out = (await run(habitsTools.weeklyReview)) as Record<string, any>;
    expect(out.revenue).toMatchObject({ status: "unknown" });
    expect(out.tasks.completed).toMatch(/unknown/);
    expect(out.tasks.completionRate).toBeNull();
  });

  it("CONTROL: measured counts stay numbers", async () => {
    h.queryNick.mockResolvedValue({ data: { totalDollars: 0, invoiceCount: 0 } });
    h.db.task.count.mockResolvedValue(0);
    const out = (await run(habitsTools.weeklyReview)) as Record<string, any>;
    expect(out.revenue).toEqual({ totalDollars: 0, invoiceCount: 0 });
    expect(out.tasks.completed).toBe(0);
  });
});

describe("findCustomer", () => {
  for (const [name, shape] of Object.entries({
    transport: { error: "fetch failed" },
    softError: SOFT_ERROR,
  })) {
    it(`a failed shop read (${name}) says the record is unknown, not 'no customer'`, async () => {
      h.queryNick.mockResolvedValue(shape);
      const out = (await run(businessTools.findCustomer, { nameOrPhone: "Jane" })) as Record<string, unknown>;
      expect(out.customer).toBe("unknown");
      expect(String(out.timeline)).toContain("unknown");
    });
  }

  it("a thrown transport error is unknown too", async () => {
    h.queryNick.mockRejectedValue(new TypeError("fetch failed"));
    const out = (await run(businessTools.findCustomer, { nameOrPhone: "Jane" })) as Record<string, unknown>;
    expect(out.customer).toBe("unknown");
  });

  it("CONTROL: a successful search with no match is a real null", async () => {
    h.queryNick.mockResolvedValue({ data: { customer: null, quotes: [] } });
    const out = (await run(businessTools.findCustomer, { nameOrPhone: "Jane" })) as Record<string, unknown>;
    expect(out.customer).toBeNull();
    expect(String(out.timeline)).not.toContain("unknown");
  });
});
