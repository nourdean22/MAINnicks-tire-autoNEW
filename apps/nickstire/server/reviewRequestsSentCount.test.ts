/**
 * Q-21 review P2-13 · Nick's operator context said "N requests sent this month"
 * over EVERY status — pending, failed, skipped and now Q-21 'heldout' controls,
 * none of which reached a customer. Only 'sent' and 'clicked' are contacts.
 */
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { reviewRequestsSentSinceQuery } from "./routers/nick/intelligence";

const dialectOnly = drizzle({ query: () => Promise.resolve([[], []]) } as never);

describe("reviewRequestsSentSinceQuery", () => {
  it("counts only sent + clicked rows since the cutoff", () => {
    const since = new Date("2026-08-30T00:00:00Z");
    const { sql, params } = reviewRequestsSentSinceQuery(dialectOnly as never, since).toSQL();
    expect(sql).toMatch(/from `review_requests`/i);
    expect(sql).toMatch(/`review_requests`\.`status` in \(\?, \?\)/i);
    expect(params).toEqual(expect.arrayContaining(["sent", "clicked"]));
    expect(params).not.toContain("heldout");
    expect(sql).toMatch(/`review_requests`\.`createdAt` >= \?/i);
  });
});
