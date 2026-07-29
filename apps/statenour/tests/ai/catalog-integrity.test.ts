import { describe, it, expect } from "vitest";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { nourTools } from "@/lib/ai/tools";

/**
 * Catalog ↔ tools bidirectional integrity (2026-07-29, audit-#10 gate).
 * The snapshot test guards "every exported tool has a catalog entry";
 * this adds the reverse (no ghost catalog rows for deleted tools), a
 * duplicate check, and makes the count DERIVED — prose counts rotted
 * from 113 → 174 across audits because nothing pinned them.
 */
describe("tool catalog integrity — both directions, no prose counts", () => {
  const catalogNames = TOOL_CATALOG.map((m) => m.name);
  const toolNames = Object.keys(nourTools);

  it("has no duplicate catalog entries", () => {
    const dupes = catalogNames.filter((n, i) => catalogNames.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("every catalog entry maps to a real exported tool (no ghosts for deleted tools)", () => {
    const ghosts = catalogNames.filter((n) => !toolNames.includes(n));
    expect(ghosts).toEqual([]);
  });

  it("every exported tool has a catalog entry (mirror of the snapshot guard)", () => {
    const uncataloged = toolNames.filter((n) => !catalogNames.includes(n));
    expect(uncataloged).toEqual([]);
  });

  it("therefore the counts agree — THE tool count is TOOL_CATALOG.length", () => {
    expect(TOOL_CATALOG.length).toBe(toolNames.length);
  });
});
