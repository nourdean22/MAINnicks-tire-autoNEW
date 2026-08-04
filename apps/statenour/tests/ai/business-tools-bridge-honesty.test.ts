/**
 * Nick must not report a fabricated $0.00 revenue month.
 *
 * `fetchBridge` returns null on EVERY shop-bridge failure — no sync key, a
 * non-2xx, a timeout, a thrown error (all four are real returns of
 * lib/nickstire/query.ts). `getRevenueStats` then computes total = 0 from an
 * empty jobs array and returns a SUCCESS-SHAPED payload:
 * `{ totalRevenue: "0.00", jobCount: 0, avgTicket: "0.00" }`.
 *
 * The service does mark it — `bridgeAvailable: false` — but that flag had zero
 * consumers anywhere in the repo, and the chat rule only permits "I don't have
 * access to that data" AFTER a tool returns null, errors, or is unavailable. A
 * zeros payload is none of those three, so the model was being directed to
 * state the fabricated zero as fact.
 *
 * TWO LAYERS ARE PINNED HERE, DELIBERATELY:
 *
 * 1. The revenue tool end to end, mocked at the NETWORK boundary (queryNick) so
 *    the whole fetchBridge -> getRevenueStats -> tool chain executes for real.
 *    That path makes a single bridge call, so it is stable.
 * 2. The dashboard redaction as a PURE function. getDashboardSummary fans out
 *    three bridge reads inside a Promise.all, and driving that from a test
 *    proved unreliable — only the first concurrent `await import()` picked up
 *    the module mock and the other two resolved the REAL client, which came
 *    back "No sync key configured." and looked exactly like a bridge outage.
 *    Rather than assert against a harness artefact, the decision itself is a
 *    pure function and is pinned directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryNick } = vi.hoisted(() => ({ queryNick: vi.fn() }));

vi.mock("@/lib/nickstire/query", () => ({ queryNick }));
vi.mock("@/lib/integrations/google-reviews", () => ({
  getReviewStats: vi.fn(async () => ({ average: 4.8, total: 120, unresponded: 2 })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { businessTools } from "@/lib/ai/tools/business";
import { redactUnreadableSections, revenueUnavailable } from "@/lib/ai/tools/bridge-honesty";

type Executable = { execute: (args: unknown, opts?: unknown) => Promise<unknown> };
const revenueTool = businessTools.getRevenueStats as unknown as Executable;

beforeEach(() => {
  queryNick.mockReset();
});

describe("getRevenueStats tool — end to end through the real service", () => {
  it("does NOT report a zero when the bridge failed", async () => {
    // The real failure member of queryNick's declared return union.
    queryNick.mockResolvedValue({ error: "HTTP 502: bad gateway", statusCode: 502 });

    const out = (await revenueTool.execute({ period: "month" }, {})) as Record<string, unknown>;

    expect(out.unavailable).toBe(true);
    // The load-bearing assertion: no fabricated money figure anywhere in the
    // payload the model will read.
    expect(JSON.stringify(out)).not.toContain("0.00");
    expect(String(out.reason)).toMatch(/unknown/i);
  });

  it("treats a missing sync key the same as a transport failure", async () => {
    // queryNick returns this shape without ever reaching the network.
    queryNick.mockResolvedValue({ error: "No sync key configured." });
    const out = (await revenueTool.execute({ period: "month" }, {})) as Record<string, unknown>;
    expect(out.unavailable).toBe(true);
  });

  it("still reports a REAL figure when the bridge answers", async () => {
    // Both directions, mandatory. A guard that always answers "unavailable"
    // would satisfy the case above while destroying the tool.
    queryNick.mockResolvedValue({
      data: { totalDollars: 4210.5, jobCount: 7 },
      query: "revenue_range",
      timestamp: "2026-08-04T00:00:00.000Z",
    });

    const out = (await revenueTool.execute({ period: "month" }, {})) as Record<string, unknown>;

    expect(out.unavailable).toBeUndefined();
    expect(out.totalRevenue).toBe("4210.50");
    expect(out.jobCount).toBe(7);
  });

  it("reports a GENUINE zero month as a real figure, not as unavailable", async () => {
    // The distinction this whole change is about: measured zero != unmeasured.
    queryNick.mockResolvedValue({
      data: { totalDollars: 0, jobCount: 0 },
      query: "revenue_range",
      timestamp: "2026-08-04T00:00:00.000Z",
    });

    const out = (await revenueTool.execute({ period: "day" }, {})) as Record<string, unknown>;

    expect(out.unavailable).toBeUndefined();
    expect(out.totalRevenue).toBe("0.00");
  });
});

describe("redactUnreadableSections", () => {
  const healthy = {
    bridgeHealth: { revenue: true, customers: true, jobsToday: true },
    revenue: { totalRevenue: "4210.50" },
    customers: { total: 5 },
    jobs: { today: 3 },
    reviews: { average: 4.8 },
  };

  it("returns the summary UNCHANGED when everything was readable", () => {
    expect(redactUnreadableSections(healthy)).toBe(healthy);
  });

  it("blanks only the sections that failed, and names them", () => {
    const out = redactUnreadableSections({
      ...healthy,
      bridgeHealth: { revenue: false, customers: true, jobsToday: false },
    }) as Record<string, unknown>;

    expect(out.revenue).toBeNull();
    expect(out.jobs).toBeNull();
    // Partial, not all-or-nothing — a real number must survive beside an unknown.
    expect(out.customers).toEqual({ total: 5 });
    expect(out.unavailable).toEqual(["revenue", "jobsToday"]);
    expect(String(out.reason)).toMatch(/UNKNOWN, not zero/);
  });

  it("blanks every section when the whole bridge is down", () => {
    const out = redactUnreadableSections({
      ...healthy,
      bridgeHealth: { revenue: false, customers: false, jobsToday: false },
    }) as Record<string, unknown>;

    expect(out.revenue).toBeNull();
    expect(out.customers).toBeNull();
    expect(out.jobs).toBeNull();
    expect(out.unavailable).toEqual(["revenue", "customers", "jobsToday"]);
  });

  it("leaves unrelated sections alone — reviews do not come from the shop bridge", () => {
    const out = redactUnreadableSections({
      ...healthy,
      bridgeHealth: { revenue: false, customers: false, jobsToday: false },
    }) as Record<string, unknown>;
    expect(out.reviews).toEqual({ average: 4.8 });
  });
});

describe("revenueUnavailable", () => {
  it("carries no figure and says unknown, not zero", () => {
    const out = revenueUnavailable("month");
    expect(out.unavailable).toBe(true);
    expect(out.period).toBe("month");
    expect(JSON.stringify(out)).not.toMatch(/\d+\.\d\d/);
    expect(out.reason).toMatch(/UNKNOWN, not a zero-revenue period/);
  });
});
