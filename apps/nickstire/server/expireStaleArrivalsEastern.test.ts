/**
 * The no-show sweep (expireStaleExpectedArrivals) compares expectedDate — a
 * shop (Eastern) calendar date — with an Eastern cutoff, never the UTC session
 * date. It used DATE_SUB(CURDATE(), …): from 8 PM ET (7 PM in winter) to
 * midnight the UTC date is already tomorrow, so an arrival was marked no_show a
 * day early, and no_show feeds the recovery lane (research doc Part L, rank 1).
 *
 * Asserted on the SQL the sweep issues (drizzle's MySQL dialect), with the
 * clock fixed; nothing touches a database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const execute = vi.fn();
vi.mock("./db", () => ({ getDb: vi.fn(async () => ({ execute })) }));

import { expireStaleExpectedArrivals } from "./services/expectedArrivals";

const dialect = new MySqlDialect();
const issued = () => execute.mock.calls.map((c) => dialect.sqlToQuery(c[0] as never));

afterEach(() => execute.mockReset());

describe("no-show sweep · the cutoff is the Eastern date", () => {
  it("at 9:30 PM ET (already tomorrow in UTC) the cutoff is today-in-Cleveland minus 2", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    // 2026-09-24 01:30 UTC = 2026-09-23 21:30 EDT.
    await expireStaleExpectedArrivals(2, new Date("2026-09-24T01:30:00Z"));
    const [q] = issued();
    expect(q!.sql).not.toMatch(/CURDATE|CURRENT_DATE|UTC_DATE/i);
    expect(q!.params).toContain("2026-09-21");
    // The UTC-date bug would have produced 2026-09-22, expiring 09-21 a day early.
    expect(q!.params).not.toContain("2026-09-22");
  });

  it("in winter (EST, UTC-5) at 7:30 PM the cutoff is still the Eastern date", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    // 2026-12-02 00:30 UTC = 2026-12-01 19:30 EST.
    await expireStaleExpectedArrivals(2, new Date("2026-12-02T00:30:00Z"));
    expect(issued()[0]!.params).toContain("2026-11-29");
  });

  it("across the spring DST change the calendar arithmetic does not skip a day", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    // 2026-03-09 14:00 UTC = 10:00 EDT on Monday; DST began Sunday 03-08.
    await expireStaleExpectedArrivals(2, new Date("2026-03-09T14:00:00Z"));
    expect(issued()[0]!.params).toContain("2026-03-07");
  });

  it("the UPDATE still only touches rows that are 'expected'", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 3 }]);
    const res = await expireStaleExpectedArrivals(2, new Date("2026-09-23T16:00:00Z"));
    expect(issued()[0]!.sql).toMatch(/status = 'expected'/);
    expect(res.expired).toBe(3);
  });
});
