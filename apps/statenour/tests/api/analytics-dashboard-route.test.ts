/**
 * GET /api/analytics/dashboard must not answer a failed shop-bridge read with a zero.
 *
 * getDashboardSummary carries each section's zero defaults beside
 * `bridgeHealth.<section>: false`. The Nick tool and the deep-reasoning lane both
 * redact that (lib/ai/tools/bridge-honesty.ts); this owner route returned it raw,
 * so a dead `customer_stats` read came back as `customers: { total: 0,
 * newThisMonth: 0 }`: a confident zero beside a flag nothing in the repo reads.
 *
 * Driven end to end: the REAL route (real apiHandler envelope), the REAL
 * getDashboardSummary, the REAL bridge client (lib/nickstire/query.ts) and the
 * REAL redaction, mocked only at `fetch` and at the review cache. Not at
 * queryNick: getDashboardSummary reaches it through three concurrent
 * `await import()`s, and a module mock there was seen by only one of them (the
 * other two ran the real client, got "No sync key" and looked exactly like a
 * bridge outage; bridge-honesty's test header records the same artefact).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/integrations/google-reviews", () => ({
  getReviewStats: vi.fn(async () => ({ average: 4.8, total: 120, unresponded: 2 })),
}));
// apiHandler's own needs: the query counter, and its sampled request-log write.
vi.mock("@/lib/prisma", () => ({
  prisma: { apiRequestLog: { create: vi.fn(async () => ({})) } },
  resetQueryCount: () => undefined,
  getQueryCount: () => 0,
}));

import { GET } from "@/app/api/analytics/dashboard/route";
import { getReviewStats } from "@/lib/integrations/google-reviews";

/** One nickstire answer: a 200 body, or a non-2xx status with its text. */
type Answer = { body: unknown } | { status: number; text: string };

const asked: string[] = [];

/** Serve POST /api/nour-os/query by query name, the way nickstire's route does. */
function nickstire(answers: Record<string, Answer>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      asked.push(query);
      const a = answers[query] ?? { status: 400, text: `Unknown query: ${query}` };
      if ("status" in a) return new Response(a.text, { status: a.status });
      return Response.json({ data: a.body, query, timestamp: "2026-10-09T12:00:00.000Z" });
    }),
  );
}

// The producers' real shapes: nour-os-query.ts revenue_range / revenue_today and
// apps/nickstire/server/services/customerStatsRead.ts.
const REVENUE_RANGE: Answer = { body: { totalDollars: 18422.75, invoiceCount: 41, avgTicket: 449.33 } };
const REVENUE_TODAY: Answer = { body: { totalDollars: 1210, invoiceCount: 3 } };
const CUSTOMERS: Answer = { body: { total: 2334, newThisMonth: 10, monthStart: "2026-10-01" } };

async function dashboard(): Promise<{ data: Record<string, unknown>; raw: string }> {
  const res = (await GET(new Request("http://x/api/analytics/dashboard"))) as Response;
  expect(res.status).toBe(200);
  const raw = await res.text();
  const body = JSON.parse(raw) as { ok: boolean; data: Record<string, unknown> };
  expect(body.ok).toBe(true);
  return { data: body.data, raw };
}

beforeEach(() => {
  asked.length = 0;
  vi.stubEnv("NICKSTIRE_URL", "http://nickstire.test");
  vi.stubEnv("STATENOUR_SYNC_KEY", "test-sync-key");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/analytics/dashboard", () => {
  it("answers a failed customer_stats read with null customers, never with zeros", async () => {
    // The historical failure exactly: nickstire had no customer_stats handler, so
    // every read was a 400 "Unknown query" (found 2026-10-08).
    nickstire({
      revenue_range: REVENUE_RANGE,
      revenue_today: REVENUE_TODAY,
      customer_stats: { status: 400, text: "Unknown query: customer_stats" },
    });

    const { data } = await dashboard();

    // The instrument fired: all three shop reads went out.
    expect([...asked].sort()).toEqual(["customer_stats", "revenue_range", "revenue_today"]);
    expect(data.customers).toBeNull();
    expect(data.unavailable).toEqual(["customers"]);
    expect(String(data.reason)).toMatch(/UNKNOWN, not zero/);
    // The flag still travels, so a reader can see WHICH read failed.
    expect((data.bridgeHealth as Record<string, boolean>).customers).toBe(false);
    // Partial, not all-or-nothing: the sections that WERE read keep their real figures.
    expect((data.revenue as Record<string, unknown>).totalRevenue).toBe("18422.75");
    expect(data.jobs).toEqual({ today: 3 });
  });

  it("treats a 200 { error } body from customer_stats as a failed read too", async () => {
    nickstire({
      revenue_range: REVENUE_RANGE,
      revenue_today: REVENUE_TODAY,
      customer_stats: { body: { error: "No DB" } },
    });
    const { data } = await dashboard();
    expect(data.customers).toBeNull();
    expect(data.unavailable).toEqual(["customers"]);
  });

  it("nulls every unread section when the bridge cannot be reached, and still serves the reviews", async () => {
    // No sync key: the bridge client refuses before any network call.
    vi.stubEnv("STATENOUR_SYNC_KEY", "");
    vi.stubEnv("BRIDGE_API_KEY", "");
    nickstire({});

    const { data, raw } = await dashboard();

    expect(asked).toEqual([]);
    expect(data.revenue).toBeNull();
    expect(data.customers).toBeNull();
    expect(data.jobs).toBeNull();
    expect(data.unavailable).toEqual(["revenue", "customers", "jobsToday"]);
    expect(data.reviews).toEqual({ average: 4.8, total: 120, unresponded: 2 });
    // The load-bearing one: no fabricated figure anywhere in what the owner receives.
    expect(raw).not.toMatch(/"(total|newThisMonth|today|jobCount)":0\b/);
    expect(raw).not.toContain("0.00");
  });

  it("returns the readable summary unchanged, with no unavailable marker", async () => {
    nickstire({ revenue_range: REVENUE_RANGE, revenue_today: REVENUE_TODAY, customer_stats: CUSTOMERS });

    const { data } = await dashboard();

    expect(data.customers).toEqual({ total: 2334, newThisMonth: 10 });
    expect(data.jobs).toEqual({ today: 3 });
    expect((data.revenue as Record<string, unknown>).jobCount).toBe(41);
    expect(data).not.toHaveProperty("unavailable");
    expect(data.bridgeHealth).toEqual({ revenue: true, customers: true, jobsToday: true });
  });

  it("a revenue_today answer without a numeric invoiceCount is an unread jobs count, not 0 jobs", async () => {
    nickstire({
      revenue_range: REVENUE_RANGE,
      revenue_today: { body: { totalDollars: 1210 } },
      customer_stats: CUSTOMERS,
    });
    const { data } = await dashboard();
    expect(data.jobs).toBeNull();
    expect(data.unavailable).toEqual(["jobsToday"]);
    expect((data.bridgeHealth as Record<string, boolean>).jobsToday).toBe(false);
  });

  it("an unreadable review store is unknown reviews, never 0 reviews (and not blamed on the bridge)", async () => {
    // getReviewStats' real failure shape (lib/integrations/google-reviews.ts): zeros with ok: false.
    vi.mocked(getReviewStats).mockResolvedValueOnce({
      total: 0, average: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, responded: 0, unresponded: 0,
      ok: false, lastWriteAt: null, ageDays: null, stale: true,
      freshnessNote: "Review store UNREADABLE — these zeros are not a measurement. Do not quote a review count.",
    } as Awaited<ReturnType<typeof getReviewStats>>);
    nickstire({ revenue_range: REVENUE_RANGE, revenue_today: REVENUE_TODAY, customer_stats: CUSTOMERS });

    const { data, raw } = await dashboard();

    expect(data.reviews).toBeNull();
    expect(data.unavailable).toEqual(["reviews"]);
    expect(String(data.reason)).toMatch(/review store could not be read/);
    expect(String(data.reason)).not.toMatch(/shop bridge/);
    expect(raw).not.toMatch(/"(average|unresponded)":0\b/);
    // The bridge sections were read and keep their figures.
    expect(data.customers).toEqual({ total: 2334, newThisMonth: 10 });
  });

  it("an empty review store (no row ever written) is no review data, never 0 reviews", async () => {
    // getReviewStats' real shape for an empty store: ok: true, zeros, lastWriteAt: null.
    vi.mocked(getReviewStats).mockResolvedValueOnce({
      total: 0, average: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, responded: 0, unresponded: 0,
      ok: true, lastWriteAt: null, ageDays: null, stale: true,
      freshnessNote: "No review rows have EVER been written — there is no review data to quote.",
    } as Awaited<ReturnType<typeof getReviewStats>>);
    nickstire({ revenue_range: REVENUE_RANGE, revenue_today: REVENUE_TODAY, customer_stats: CUSTOMERS });

    const { data, raw } = await dashboard();

    expect(data.reviews).toBeNull();
    expect(data.unavailable).toEqual(["reviews"]);
    expect(String(data.reason)).toMatch(/holds no review data/);
    expect(raw).not.toMatch(/"(average|unresponded)":0\b/);
  });

  it("keeps a MEASURED zero as a zero: a read that answered 0 is not an unread one", async () => {
    // A month with no new customers yet is a real 0, and must not be blanked.
    nickstire({
      revenue_range: REVENUE_RANGE,
      revenue_today: REVENUE_TODAY,
      customer_stats: { body: { total: 2334, newThisMonth: 0, monthStart: "2026-10-01" } },
    });
    const { data } = await dashboard();
    expect(data.customers).toEqual({ total: 2334, newThisMonth: 0 });
    expect(data).not.toHaveProperty("unavailable");
  });
});
