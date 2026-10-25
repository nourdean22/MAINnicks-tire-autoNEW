/**
 * The Customers tab's segment rules (2026-10-25). The banner said "758 VIPs
 * lapsed" while the roster on the same screen said "169 VIPs (3+ visits)" and
 * "744 lapsed": two definitions of VIP and two of lapsed. The rules now live
 * once in shared/customerSegments.ts and render into SQL here.
 */
import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import type { SQL } from "drizzle-orm";
import { countLapsedRegulars, lapsedCondition, vipCondition } from "./customer-segments";
import { campaignEligiblePhoneSql } from "./sms-eligibility";
import { LAPSED_MAX_DAYS, LAPSED_MIN_DAYS, LAPSED_REGULAR_RULE, VIP_MIN_VISITS } from "../../shared/customerSegments";

const render = (s: SQL) => new MySqlDialect().sqlToQuery(s).sql;

describe("customer segment rules", () => {
  it("the house rule is 3+ visits and a last visit 90 to 365 days ago (moving it is Nour's call)", () => {
    expect([VIP_MIN_VISITS, LAPSED_MIN_DAYS, LAPSED_MAX_DAYS]).toEqual([3, 90, 365]);
    expect(LAPSED_REGULAR_RULE).toBe("3+ visits, last visit 90 to 365 days ago");
  });

  it("lapsedCondition is the bounded 90 to 365 day window, computed in SQL from the shared constants", () => {
    expect(render(lapsedCondition())).toBe(
      `\`customers\`.\`lastVisitDate\` < DATE_SUB(NOW(), INTERVAL ${LAPSED_MIN_DAYS} DAY) AND \`customers\`.\`lastVisitDate\` >= DATE_SUB(NOW(), INTERVAL ${LAPSED_MAX_DAYS} DAY)`,
    );
  });

  it("vipCondition is totalVisits >= the shared floor", () => {
    expect(render(vipCondition())).toBe(`\`customers\`.\`totalVisits\` >= ${VIP_MIN_VISITS}`);
  });

  it("countLapsedRegulars: qualifying is both rules together; contactable adds only the canonical eligibility predicate", async () => {
    const queries: string[] = [];
    const fake = {
      query: async (q: { sql: string }) => {
        queries.push(q.sql);
        return [[[/sms_preferences/.test(q.sql) ? "9" : "12"]], []];
      },
    };
    const out = await countLapsedRegulars(drizzle(fake as never) as never);
    expect(out).toEqual({ qualifying: 12, contactable: 9 });
    const rule = `(${render(vipCondition())}) AND (${render(lapsedCondition())})`;
    const eligible = render(campaignEligiblePhoneSql);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatch(new RegExp(`where ${escapeRe(rule)}$`));
    expect(queries[1]).toMatch(new RegExp(`where ${escapeRe(rule)} AND ${escapeRe(eligible)}$`));
  });
});

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
