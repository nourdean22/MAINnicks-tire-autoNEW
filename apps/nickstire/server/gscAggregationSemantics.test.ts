/**
 * GSC aggregation semantics. Four defects, each rendered on an operator
 * surface, each with a worked counterexample in its own test.
 *
 * These are SOURCE assertions on the SQL, deliberately. The alternative —
 * seeding TiDB and reading it back — needs a database this worktree does not
 * have, and the failure being guarded is a formula shipping wrong, which is
 * visible in the text. Each test names the exact wrong form so a revert fails
 * loudly rather than silently restoring the bug.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sliceBlock } from "./testUtils/sourceBlock";
import { resolve } from "node:path";

const APP = process.cwd();
const GSC = readFileSync(resolve(APP, "server/pipelines/gsc-data.ts"), "utf8");
const MARKET = readFileSync(resolve(APP, "server/routers/admin/market.ts"), "utf8");
const CLOSED_LOOP = readFileSync(resolve(APP, "server/services/closedLoop.ts"), "utf8");

/** Strip comments so a doc-comment quoting the wrong form cannot fail a test. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("F1 — the Market headline prefers Google's official no-dimension total", () => {
  it("summary calls getGscReport, not only getGscSummary", () => {
    // Stored rows come from a QUERY-dimensioned request, and Google omits
    // anonymized queries from those. Property truth 100 clicks / 4,000 impr
    // (2.50% CTR) renders as 62 / 2,300 / 2.70% — clicks -38%, impressions
    // -43%, and CTR wrong in the OPPOSITE direction.
    const c = code(MARKET);
    expect(c).toContain("getGscReport");
    expect(c, "summary must not depend on the dimensioned sum alone").toMatch(
      /getGscSummary,\s*getGscReport|getGscReport,\s*getGscSummary/,
    );
  });

  it("the fallback is LABELLED, so partial can never read as the total", () => {
    const c = code(MARKET);
    expect(c).toContain("gsc_official_no_dimension");
    expect(c).toContain("stored_query_rows_partial");
  });

  it("the official CTR ratio is converted to percent", () => {
    // Google returns 0.025; the card speaks 2.5. Passing the ratio through
    // renders 0.0% on a healthy site — a silent 100x understatement.
    expect(code(MARKET)).toMatch(/summary\.ctr\s*\*\s*100/);
  });
});

describe("F2 — page CTR comes from SUMS, never AVG of stored per-row CTRs", () => {
  it("getPagePerformance does not average the ctr column", () => {
    // Rows split by date x device x country. Two rows — (1 click / 1 impr)
    // and (9 clicks / 999 impr) — have a true CTR of 1.0%. AVG(ctr) returns
    // 50.5%: a 50x overstatement, rendered on Market "Top pages".
    const fn = code(GSC).slice(code(GSC).indexOf("getPagePerformance"));
    expect(fn.slice(0, 1200), "AVG(ctr) is back").not.toMatch(/AVG\(\$\{searchPerformance\.ctr\}\)/);
  });

  it("no AVG(ctr) survives anywhere in the pipeline", () => {
    expect(code(GSC)).not.toMatch(/AVG\(\$\{searchPerformance\.ctr\}\)/);
  });
});

describe("F3 — average position is impression-weighted everywhere", () => {
  it("no unweighted AVG(position) remains", () => {
    // (1,000 impr @ pos 3.0) + (1 impr @ pos 97.0) weights to 3.09 and
    // averages to 50.0. The Market panel showed position 50 for a #3 query,
    // directly beneath a summary card using the weighted definition.
    expect(
      code(GSC),
      "an unweighted AVG(position) is back — a 1-impression outlier can dominate",
    ).not.toMatch(/AVG\(\$\{searchPerformance\.position\}\)/);
  });

  it("the weighted form is actually present — the positive control", () => {
    // Without this, deleting every position aggregation would satisfy the
    // assertion above.
    const weighted = code(GSC).match(
      /SUM\(\$\{searchPerformance\.position\}\s*\*\s*\$\{searchPerformance\.impressions\}\)/g,
    );
    expect(weighted?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});

describe("F4 — the tire-size KPI can actually match a row", () => {
  it("matches absolute URLs, because the page column stores them verbatim", () => {
    // The GSC `page` dimension is an absolute URL. '/tires/%' matched zero
    // rows, so this registered closed-loop KPI returned 0 forever —
    // indistinguishable from "the tire-size guides are not working", which is
    // the exact thing it was created to measure.
    const c = code(CLOSED_LOOP);
    expect(c, "the prefix-anchored LIKE is back — this KPI cannot fire").not.toContain(
      "page LIKE '/tires/%'",
    );
    expect(c).toContain("page LIKE '%/tires/%'");
  });

  it("a full production URL satisfies the pattern it now uses", () => {
    // Executable proof rather than a source claim: this is the exact string
    // shape stored by fetchSearchPerformance.
    const like = (v: string, pat: string) =>
      new RegExp("^" + pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$").test(v);
    expect(like("https://nickstire.org/tires/205-55r16", "%/tires/%")).toBe(true);
    expect(like("https://nickstire.org/tires/205-55r16", "/tires/%")).toBe(false);
  });
});

describe("F5 — the Traffic Funnel reads web rows only, impression-weighted (2026-10-02)", () => {
  const FUNNEL = readFileSync(resolve(APP, "server/routers/trafficFunnel.ts"), "utf8");

  it("every search_performance read filters searchType = 'web'", () => {
    // Discover rows carry query='' and no position meaning; summing them into the
    // funnel inflated clicks/impressions and added a blank top-query bucket.
    const c = code(FUNNEL);
    const reads = c.split("FROM search_performance").length - 1;
    const filtered = c.split("FROM search_performance").slice(1).filter((tail) => /^[\s\S]{0,200}searchType = 'web'/.test(tail)).length;
    expect(reads).toBeGreaterThan(0);
    expect(filtered).toBe(reads);
  });

  it("no unweighted AVG(position) remains in the funnel", () => {
    const c = code(FUNNEL);
    expect(c).not.toMatch(/AVG\(\s*position\s*\)/i);
    expect(c).toMatch(/SUM\(position \* impressions\) \/ NULLIF\(SUM\(impressions\), 0\)/);
  });
});

describe("F6 — the StateNour bridge gsc_summary prefers the official total and labels it (2026-10-02)", () => {
  const BRIDGE = readFileSync(resolve(APP, "server/routes/nour-os-query.ts"), "utf8");
  const handler = () => {
    return sliceBlock(code(BRIDGE), '"gsc_summary": async', '"gsc_top_queries"', { label: "nour-os-query.ts" });
  };

  it("calls getGscReport before falling back to the stored rows", () => {
    const h = handler();
    expect(h).toContain("getGscReport");
    expect(h.indexOf("getGscReport({")).toBeLessThan(h.indexOf("getGscSummary({"));
  });

  it("both branches carry a source label, and the official CTR ratio becomes percent", () => {
    const h = handler();
    expect(h).toContain('source: "gsc_official_no_dimension"');
    expect(h).toContain('source: "stored_query_rows_partial"');
    expect(h).toMatch(/official\.summary\.ctr \* 100/);
  });
});

describe("F7 — an empty official response is not an official zero (2026-10-02)", () => {
  const GSC_SRC = code(GSC);
  it("getGscReport reports summaryHasData from the presence of the total row", () => {
    expect(GSC_SRC).toMatch(/summaryHasData: totalRows\.length > 0/);
  });
  it("every summary-only caller asks for totals only and gates on summaryHasData", () => {
    for (const f of ["server/routers/admin/market.ts", "server/routes/nour-os-query.ts", "server/routers/trafficFunnel.ts"]) {
      const c = code(readFileSync(resolve(APP, f), "utf8"));
      expect(c, f).toMatch(/getGscReport\([^)]*\{ totalsOnly: true \}\)/);
      expect(c, f).toContain("official?.summaryHasData");
    }
    const rev = code(readFileSync(resolve(APP, "server/routers/revenueOps.ts"), "utf8"));
    expect(rev).toContain("officialResult.value.summaryHasData");
  });
});

describe("F8 — statenourMetrics refuses an empty official window instead of sending a labelled zero", () => {
  it("throws PRECONDITION_FAILED when summaryHasData is false", () => {
    const c = code(readFileSync(resolve(APP, "server/routers/statenourMetrics.ts"), "utf8"));
    expect(c).toMatch(/if \(!report\.summaryHasData\) \{\s*throw new TRPCError\(\{\s*code: "PRECONDITION_FAILED"/);
  });
});

describe("F9 — the Traffic Funnel's GSC stages prefer the official total and label it (2026-10-07)", () => {
  const FUNNEL = code(readFileSync(resolve(APP, "server/routers/trafficFunnel.ts"), "utf8"));
  it("both provenance labels exist and ride out on the payload", () => {
    // Pre-fix: the "Google Impressions" and "Clicks to Site" stages were the SUM of
    // stored query rows (anonymized queries missing), unlabelled.
    expect(FUNNEL).toContain('"gsc_official_no_dimension"');
    expect(FUNNEL).toContain('"stored_query_rows_partial"');
    expect(FUNNEL).toMatch(/raw: \{\s*gscSource,/);
  });
});

