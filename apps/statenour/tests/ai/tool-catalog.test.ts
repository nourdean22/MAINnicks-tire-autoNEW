/**
 * Tool catalog contract test (W6).
 *
 * Protects the lib/ai/tools.ts ↔ lib/ai/tools/catalog.ts invariant:
 *   1. Every tool exported from nourTools has a catalog entry.
 *   2. Every catalog entry has a matching tool.
 *   3. TOOL_COUNT equals the actual exported tool count.
 *   4. No duplicate names in the catalog.
 *
 * When you ADD a tool:
 *   1. Add it to nourTools in lib/ai/tools.ts
 *   2. Add a TOOL_CATALOG entry in lib/ai/tools/catalog.ts
 *   3. Snapshot test stays green — this contract test catches you
 *      if you forget step 2.
 *
 * When you REMOVE a tool:
 *   1. Remove from nourTools
 *   2. Remove from TOOL_CATALOG
 *
 * Schema snapshot testing (locks actual tool input-shapes) lives in
 * tool-schemas.snapshot.test.ts.
 */

import { describe, it, expect } from "vitest";
import { nourTools } from "@/lib/ai/tools";
import { TOOL_CATALOG, TOOL_COUNT, getToolMeta } from "@/lib/ai/tools/catalog";

describe("tool catalog · contract", () => {
  const exportedNames = Object.keys(nourTools);
  const catalogNames = TOOL_CATALOG.map((t) => t.name);
  const exportedSet = new Set(exportedNames);
  const catalogSet = new Set(catalogNames);

  it("exported tool count matches catalog count", () => {
    expect(exportedNames.length).toBe(TOOL_COUNT);
    expect(TOOL_CATALOG.length).toBe(TOOL_COUNT);
  });

  it("every exported tool has a catalog entry", () => {
    const missingFromCatalog = exportedNames.filter((n) => !catalogSet.has(n));
    expect(missingFromCatalog, `tools present in nourTools but missing from TOOL_CATALOG: ${missingFromCatalog.join(", ")}`).toEqual([]);
  });

  it("every catalog entry has a matching tool export", () => {
    const missingFromExports = catalogNames.filter((n) => !exportedSet.has(n));
    expect(missingFromExports, `catalog entries not backed by an exported tool: ${missingFromExports.join(", ")}`).toEqual([]);
  });

  it("no duplicate names in the catalog", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of TOOL_CATALOG) {
      if (seen.has(t.name)) dupes.push(t.name);
      seen.add(t.name);
    }
    expect(dupes).toEqual([]);
  });

  it("getToolMeta resolves every real tool", () => {
    for (const name of exportedNames) {
      const meta = getToolMeta(name);
      expect(meta, `no meta for ${name}`).not.toBeNull();
      expect(meta!.name).toBe(name);
    }
  });
});
