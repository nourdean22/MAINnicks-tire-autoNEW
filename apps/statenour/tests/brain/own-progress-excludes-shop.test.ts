/**
 * R2b round 1 item 5 (2026-11-03): the nightly shop sync writes progress_logged events with source
 * shop-bridge. "Goals lifted today" (today-compound, both the service and the legacy REST route) and
 * "loops this week" (getProgressInWindow) count Nour's OWN actions, so they exclude that source. The value
 * sparkline (getProgressSparkline) is value history and keeps every event.
 *
 * The fake goalEvent store evaluates the where clause the way Postgres does, including the trap that
 * `source <> 'shop-bridge'` is not true for a NULL source: a hand event with no source must still count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ev = { goalId: string; kind: string; source: string | null; payload: { delta: number }; createdAt: Date };
const h = vi.hoisted(() => ({ rows: [] as unknown[] }));

function match(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") {
      if (!(v as Record<string, unknown>[]).some((w) => match(row, w))) return false;
      continue;
    }
    if (k === "NOT") {
      if (match(row, v as Record<string, unknown>)) return false;
      continue;
    }
    const val = row[k] as never;
    if (v === null) {
      if (val !== null) return false;
    } else if (typeof v === "object" && !(v instanceof Date)) {
      const c = v as { gte?: Date; lte?: Date; not?: unknown };
      if (c.gte !== undefined && !(val >= c.gte)) return false;
      if (c.lte !== undefined && !(val <= c.lte)) return false;
      // SQL: NULL <> 'x' is NULL, not true.
      if ("not" in c && (val === null || val === c.not)) return false;
    } else if (val !== v) return false;
  }
  return true;
}
const filtered = (where: Record<string, unknown>) => (h.rows as Ev[]).filter((r) => match(r as never, where));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    goalEvent: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => filtered(where),
      groupBy: async ({ where }: { where: Record<string, unknown> }) =>
        [...new Set(filtered(where).map((r) => r.goalId))].map((goalId) => ({ goalId })),
    },
    masteryScore: { findMany: async () => [] },
    brainMemory: { count: async () => 0, findMany: async () => [] },
    task: { findMany: async () => [], count: async () => 0 },
    apiRequestLog: { create: async () => ({}) },
  },
  resetQueryCount: () => {},
  getQueryCount: () => 0,
}));
vi.mock("@/lib/auth-guard", () => ({
  requireSession: vi.fn(async () => ({ id: "operator-1" })),
  requireCronAuth: vi.fn(),
  requireSyncAuth: vi.fn(),
}));

import { getProgressInWindow, getProgressSparkline } from "@/lib/brain/goal-events";
import { buildTodayCompound } from "@/lib/services/today-compound";
import { GET } from "@/app/api/tasks/today-compound/route";

// 18:00Z is 13:00 EST on 2026-11-03.
const NOW = new Date("2026-11-03T18:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.rows = [
    { goalId: "g_shop", kind: "progress_logged", source: "shop-bridge", payload: { delta: 500 }, createdAt: ago(1) },
    { goalId: "g_hand", kind: "progress_logged", source: "api:goals.PATCH", payload: { delta: 2 }, createdAt: ago(2) },
    { goalId: "g_old", kind: "progress_logged", source: null, payload: { delta: 1 }, createdAt: ago(3) },
  ] satisfies Ev[];
});
afterEach(() => vi.useRealTimers());

describe("Nour's own progress excludes the shop sync's values", () => {
  it("goals lifted today (the service) counts the hand-logged goals only, a NULL source included", async () => {
    expect((await buildTodayCompound()).goalsLifted).toBe(2);
  });

  it("goals lifted today (the legacy REST route) agrees", async () => {
    const res = (await GET(new Request("http://localhost/api/tasks/today-compound") as never, { params: Promise.resolve({}) } as never)) as Response;
    const json = (await res.json()) as { data?: { goalsLifted: number }; goalsLifted?: number };
    expect((json.data ?? json).goalsLifted).toBe(2);
  });

  it("loops this week skips a shop-bridge event and keeps a hand-logged one", async () => {
    expect(await getProgressInWindow("g_shop")).toEqual({ totalDelta: 0, events: 0 });
    expect(await getProgressInWindow("g_hand")).toEqual({ totalDelta: 2, events: 1 });
    expect(await getProgressInWindow("g_old")).toEqual({ totalDelta: 1, events: 1 });
  });

  it("the value sparkline keeps both: it is the goal's value history", async () => {
    expect((await getProgressSparkline("g_shop")).at(-1)).toBe(500);
    expect((await getProgressSparkline("g_hand")).at(-1)).toBe(2);
  });
});
