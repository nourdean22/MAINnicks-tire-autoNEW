/**
 * server/__tests__/market-and-ribbon-public.test.ts · 2026-09-08
 *
 * Two contracts, pinned by reading the modules (no DB):
 *   · the `market` admin router exists with the four procedures the admin
 *     MarketSection renders, and serves the master report from the SAME
 *     handler map the nour-os bridge uses;
 *   · the PUBLIC PhotoRibbon reads a public procedure (D14): the admin one
 *     stays admin, the public one is cached and returns src + count only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("market admin router", () => {
  const src = read("server/routers/admin/market.ts");
  it("exposes summary, topQueries, topPages, report — all admin-gated", () => {
    for (const p of ["summary", "topQueries", "topPages", "report"]) {
      expect(src, p).toMatch(new RegExp(`\\b${p}: adminProcedure`));
    }
    expect(src).not.toMatch(/publicProcedure/);
  });
  it("the report comes from the bridge's handler map, so the two readers cannot drift", () => {
    expect(src).toMatch(/QUERY_HANDLERS\.master_report\(/);
    expect(read("server/routes/nour-os-query.ts")).toMatch(/export const QUERY_HANDLERS/);
  });
  it("is mounted as `market` and registered as an admin section", () => {
    expect(read("server/routers.ts")).toMatch(/market: marketAdminRouter/);
    expect(read("client/src/pages/admin/registry.tsx")).toMatch(/id: "market"/);
    expect(read("client/src/pages/admin/shared/types.ts")).toMatch(/"market"/);
  });
});

describe("PhotoRibbon reads a public procedure (D14)", () => {
  const events = read("server/routers/admin/customerEvents.ts");
  it("the admin procedure is still admin; the public one is public and cached", () => {
    expect(events).toMatch(/topRibbonPhotos: adminProcedure/);
    expect(events).toMatch(/topRibbonPhotosPublic: publicProcedure/);
    expect(events).toMatch(/ribbonCache/);
  });
  it("the public component no longer calls the admin procedure", () => {
    const ribbon = read("client/src/components/PhotoRibbon.tsx");
    expect(ribbon).toMatch(/topRibbonPhotosPublic\.useQuery/);
    expect(ribbon).not.toMatch(/topRibbonPhotos\.useQuery/);
  });
});

describe("ribbon photo counts · GROUP BY must be the SAME expression as the SELECT (Sentry NICKSTIRE-1, 2026-09-08)", () => {
  it("drizzle renders a column reference differently in select vs groupBy — the trap, pinned", async () => {
    const { QueryBuilder } = await import("drizzle-orm/mysql-core");
    const { sql } = await import("drizzle-orm");
    const { customerEvents } = await import("../../drizzle/schema");
    const qb = new QueryBuilder();
    const trap = qb
      .select({ src: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${customerEvents.eventData}, '$.src'))` })
      .from(customerEvents)
      .groupBy(sql`JSON_UNQUOTE(JSON_EXTRACT(${customerEvents.eventData}, '$.src'))`)
      .toSQL().sql;
    const selectExpr = trap.slice(trap.indexOf("select ") + 7, trap.indexOf(" from "));
    const groupExpr = trap.slice(trap.indexOf("group by ") + 9);
    expect(selectExpr, "known positive: qualified in groupBy, bare in select → only_full_group_by rejects it").not.toBe(groupExpr);
  });
  it("the shipped query uses ONE unqualified fragment in both positions, which renders identically", async () => {
    const { QueryBuilder } = await import("drizzle-orm/mysql-core");
    const { sql } = await import("drizzle-orm");
    const { customerEvents } = await import("../../drizzle/schema");
    const srcExpr = sql`JSON_UNQUOTE(JSON_EXTRACT(eventData, '$.src'))`;
    const fixed = new QueryBuilder().select({ src: sql<string>`${srcExpr}` }).from(customerEvents).groupBy(srcExpr).toSQL().sql;
    const selectExpr = fixed.slice(fixed.indexOf("select ") + 7, fixed.indexOf(" from "));
    const groupExpr = fixed.slice(fixed.indexOf("group by ") + 9);
    expect(selectExpr).toBe(groupExpr);
    const src = read("server/routers/admin/customerEvents.ts");
    expect(src).toMatch(/const srcExpr = sql`JSON_UNQUOTE\(JSON_EXTRACT\(eventData, '\$\.src'\)\)`;/);
    expect(src).toMatch(/src: sql<string>`\$\{srcExpr\}`/);
    expect(src).toMatch(/\.groupBy\(srcExpr\)/);
    expect(src).not.toMatch(/groupBy\(sql`JSON_UNQUOTE\(JSON_EXTRACT\(\$\{customerEvents\.eventData\}/);
  });
});
