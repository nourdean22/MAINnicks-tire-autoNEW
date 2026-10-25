/**
 * adminDashboard.sectionInsight, case "customers" (2026-10-25).
 *
 * The banner counted "$500+ spend, no visit in 180+ days" with no upper bound
 * (758) while the roster beside it counted 3+ visits and 90 to 365 days. It now
 * counts the same lapsed regulars as customers.stats, says how many can be
 * texted (the canonical eligibility predicate), and its action opens Outreach >
 * Win-Back instead of the retired "reEngagement" section.
 *
 * The real drizzle builder runs over a fake mysql2 client, so the assertions are
 * on the SQL the router actually sends.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const h = vi.hoisted(() => ({
  queries: [] as string[],
  qualifying: "12" as string,
  contactable: "9" as string,
  db: null as unknown,
  cohort: null as unknown,
}));

const fakeClient = {
  query: vi.fn(async (q: { sql: string } | string) => {
    const text = typeof q === "string" ? q : q.sql;
    h.queries.push(text);
    // Counts arrive as strings from mysql2.
    if (/sms_preferences/.test(text)) return [[[h.contactable]], []];
    return [[[h.qualifying]], []];
  }),
};
const realDrizzle = drizzle(fakeClient as never);

vi.mock("../../../db", () => ({ getDb: async () => null, getDbTyped: async () => h.db }));
vi.mock("../../../lib/retentionCohorts", () => ({ getRetentionCohortSummary: async () => h.cohort }));

import { router } from "../../../_core/trpc";
import { sectionInsightProcedures } from "./sectionInsight";
import { campaignEligiblePhoneSql } from "../../../lib/sms-eligibility";
import { LAPSED_REGULAR_RULE } from "../../../../shared/customerSegments";

const insightRouter = router(sectionInsightProcedures);
function ctx(role: "admin" | "user" = "admin") {
  return {
    user: {
      id: 1, openId: `${role}-user`, email: `${role}@nickstire.com`, name: role, loginMethod: "manus",
      role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}
const customersInsight = () => insightRouter.createCaller(ctx()).sectionInsight({ section: "customers" });
const WIN_BACK = { label: "Open Win-Back", section: "campaigns", params: { outreachTab: "winback" } };
const customerQueries = () => h.queries.filter((q) => /from `customers`/i.test(q));

beforeEach(() => {
  h.queries = [];
  h.qualifying = "12";
  h.contactable = "9";
  h.db = realDrizzle;
  h.cohort = null;
});

describe("sectionInsight customers", () => {
  it("counts lapsed regulars (3+ visits, 90 to 365 days) and how many can be texted, and opens Win-Back", async () => {
    const out = await customersInsight();
    expect(out).toEqual({
      variant: "primary",
      message: `12 lapsed regulars (${LAPSED_REGULAR_RULE}); 9 can be texted.`,
      metric: "12 lapsed regulars",
      cta: WIN_BACK,
    });
  });

  it("the SQL is the house rule: totalVisits >= 3 inside the 90 to 365 day window, never $500 or 180 days", async () => {
    await customersInsight();
    const qs = customerQueries();
    expect(qs).toHaveLength(2);
    for (const q of qs) {
      expect(q).toContain("`customers`.`totalVisits` >= 3");
      expect(q).toContain("INTERVAL 90 DAY");
      expect(q).toContain("INTERVAL 365 DAY");
      expect(q).not.toMatch(/totalSpent|50000|180/);
    }
  });

  it("contactable is the qualifying set AND the canonical eligibility predicate (no fourth opt-out check)", async () => {
    await customersInsight();
    const eligible = new MySqlDialect().sqlToQuery(campaignEligiblePhoneSql).sql;
    const [withPredicate, without] = [
      customerQueries().filter((q) => q.includes(eligible)),
      customerQueries().filter((q) => !q.includes(eligible)),
    ];
    expect(withPredicate).toHaveLength(1);
    expect(without).toHaveLength(1);
  });

  it("below 3 lapsed regulars it falls back to the retention cohort, whose action also opens Win-Back", async () => {
    h.qualifying = "2";
    h.cohort = {
      customersWithVisits: 2119,
      oneAndDone: { count: 900, pct: 42 },
      reactivationEligible: { count: 300, lifetimeValueCents: 4_500_000 },
    };
    const out = await customersInsight();
    expect(out?.metric).toBe("42% one-and-done");
    expect(out?.cta).toEqual(WIN_BACK);
  });

  it("a dead database handle is SERVICE_UNAVAILABLE, not an empty banner", async () => {
    h.db = null;
    await expect(customersInsight()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
