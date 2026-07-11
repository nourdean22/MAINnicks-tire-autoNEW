import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Regression lock (2026-07-11): the admin "Run migrations" endpoint once
 * re-added a NARROW unique key (date, query, page) on search_performance via
 * a destructive DELETE ... GROUP BY, silently collapsing every distinct
 * device/country/searchType breakdown on every click — even though
 * drizzle/schema.ts has always declared the wide key. See intelligence.ts
 * for the full incident writeup. This test fails loudly if the narrow
 * pattern is ever reintroduced.
 */
describe("search_performance migration statements never re-add the narrow key", () => {
  const source = readFileSync(
    join(__dirname, "..", "routers", "nick", "intelligence.ts"),
    "utf8",
  );

  it("does not contain the narrow (date, query, page)-only unique key statement", () => {
    expect(source).not.toMatch(/ADD UNIQUE KEY uq_search_perf_date_query_page\s*\(/);
  });

  it("does not group the dedupe DELETE by (date, query, page) alone", () => {
    expect(source).not.toMatch(
      /DELETE FROM search_performance WHERE id NOT IN[\s\S]{0,120}GROUP BY date, query, page\)/,
    );
  });

  it("the wide unique key statement, when present, includes all 6 columns", () => {
    // Non-greedy up to `)` immediately followed by the closing template-
    // literal backtick — the naive `[^)]+` alternative stops at the first
    // `)` it meets, which is inside `query(191)` itself.
    const wideKeyMatch = source.match(
      /ADD UNIQUE KEY uq_search_perf_date_query_page_device_country_type\s*\(([\s\S]+?)\)`/,
    );
    expect(wideKeyMatch, "expected the wide-key ADD statement to be present").toBeTruthy();
    const columns = wideKeyMatch![1];
    for (const col of ["date", "query", "page", "device", "country", "searchType"]) {
      expect(columns).toContain(col);
    }
  });
});
