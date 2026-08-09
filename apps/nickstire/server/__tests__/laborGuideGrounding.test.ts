/**
 * The Auto Labor Guide grounding must actually REACH the prompt.
 *
 * THE DEFECT (fixed 2026-08-09). `server/laborEstimate.ts` reached the 62-job
 * labor-time table through `autoLaborRouter.createCaller({} as any)
 * .searchJobs(...)`. `searchJobs` is an adminProcedure; an empty context has no
 * `ctx.user`, so it threw FORBIDDEN on EVERY request. laborEstimate's catch
 * swallowed it and returned "", so the "AUTO LABOR GUIDE REFERENCE DATA" block
 * was NEVER injected — the model estimated labor hours with zero grounding on a
 * customer-facing path while the verified table sat one call away.
 *
 * Runtime-confirmed before the fix:
 *   [tRPC ERROR] query searchJobs (1ms): You do not have required permission (10002)
 *
 * WHY THIS TEST SHAPE. The failure was SILENT — a swallowed throw that returned
 * an empty string. Nothing distinguished "no matching jobs" from "the lookup is
 * permanently broken", which is exactly why it survived. So these assert the
 * DATA PATH is reachable without auth, not merely that the function returns.
 */
import { describe, it, expect } from "vitest";
import { searchLaborJobs } from "../routers/autoLabor";

describe("Auto Labor Guide · reachable without an admin context", () => {
  it("returns real labor times for a common repair, with NO tRPC context at all", () => {
    // The pre-fix code needed ctx.user.role === "admin" to get here.
    const results = searchLaborJobs("brake");
    expect(results.length, "brake search returned nothing — the ALG table is unreachable").toBeGreaterThan(0);

    const first = results[0];
    expect(first.job.name).toBeTruthy();
    expect(first.job.minHours).toBeGreaterThan(0);
    expect(first.job.maxHours).toBeGreaterThanOrEqual(first.job.minHours);
    expect(first.categoryName).toBeTruthy();
  });

  it("matches on job name, notes AND category — the three fields the search claims to cover", () => {
    expect(searchLaborJobs("brake").length).toBeGreaterThan(0);
    // A category-level term must still hit even when no job NAME contains it.
    const byCategory = searchLaborJobs("suspension");
    expect(byCategory.length, "category-name matching regressed").toBeGreaterThan(0);
  });

  it("returns [] for a term that matches nothing — the honest empty, distinguishable from a broken lookup", () => {
    expect(searchLaborJobs("zzzznotarealrepair")).toEqual([]);
  });

  it("the admin procedure and the public search share ONE implementation", async () => {
    // Guards the drift this fix was meant to prevent: if searchJobs ever grows
    // its own copy of the loop again, the two can diverge silently.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "server", "routers", "autoLabor.ts"), "utf8");
    const proc = src.slice(src.indexOf("searchJobs: adminProcedure"));
    const body = proc.slice(0, proc.indexOf("}),"));
    expect(body, "searchJobs stopped delegating to searchLaborJobs").toContain("searchLaborJobs(");
    expect(
      body,
      "searchJobs re-implemented the category loop instead of delegating — the two can now drift",
    ).not.toContain("Object.entries(LABOR_CATEGORIES)");
  });
});

describe("laborEstimate · no longer calls the admin procedure", () => {
  it("does not reach the labor table through createCaller (the FORBIDDEN path)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "server", "laborEstimate.ts"), "utf8");
    // Strip comments — the fix comment quotes the old call on purpose, and this
    // repo has been bitten before by a file-text negative matching its own comment.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "laborEstimate is calling the adminProcedure again — it will throw FORBIDDEN and fail silently")
      .not.toContain("createCaller");
    expect(code).toContain("searchLaborJobs");
  });
});
