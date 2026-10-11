/**
 * tests/ai/list-tools-matches-catalog.test.ts - audit 03-F17 (2026-10-11).
 *
 * listTools answers "what can you do?" and says it lists ALL tools, but it
 * returned a hand-kept list of 48 names in made-up categories while the
 * catalog held every registered tool. The answer must come from TOOL_CATALOG,
 * the single source catalog-integrity pins against nourTools.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { metaTools } from "@/lib/ai/tools/meta";
import { TOOL_CATALOG, toolNamesByCategory, type ToolCategory } from "@/lib/ai/tools/catalog";

type Listing = {
  totalTools?: number;
  categories?: Array<{ category: string; count: number; tools: string[] }>;
  category?: string;
  count?: number;
  tools?: string[];
};
const listTools = (input: { category?: string }) =>
  (metaTools.listTools.execute as (i: unknown, o: unknown) => Promise<Listing>)(input, {});

describe("listTools reports the catalog, not a hand-kept list", () => {
  it("with no filter: totalTools is the catalog size and the names are exactly the catalog", async () => {
    const all = await listTools({});
    expect(all.totalTools).toBe(TOOL_CATALOG.length);
    const names = (all.categories ?? []).flatMap((c) => c.tools);
    expect(names.length).toBe(TOOL_CATALOG.length);
    expect(new Set(names)).toEqual(new Set(TOOL_CATALOG.map((t) => t.name)));
  });

  it("a catalog category returns exactly that category's tools", async () => {
    const cat: ToolCategory = "browser";
    const one = await listTools({ category: cat });
    expect(one.category).toBe(cat);
    expect(one.tools).toEqual(toolNamesByCategory(cat));
    expect(one.count).toBe(toolNamesByCategory(cat).length);
  });

  it("an unknown category returns every category (the describe() promise)", async () => {
    const res = await listTools({ category: "not-a-category" });
    expect(res.totalTools).toBe(TOOL_CATALOG.length);
  });

  it("CONTROL: the catalog has more than one category and a real tool count", () => {
    expect(new Set(TOOL_CATALOG.map((t) => t.category)).size).toBeGreaterThan(1);
    expect(toolNamesByCategory("browser").length).toBeGreaterThan(0);
  });
});
