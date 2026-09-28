import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";

const PRIOR = readFileSync(path.join(__dirname, "services", "reelStructurePrior.ts"), "utf8");

describe("Pattern Lab bootstrap wiring", () => {
  it("bootstraps only after an observed empty read, then re-reads before selection", () => {
    const block = sliceBlock(
      PRIOR,
      "if (rows.length === 0) {",
      "if (rows.length === 0) return null;",
      { label: "reelStructurePrior.emptyLabBootstrap" },
    );
    expect(block).toContain('await import("./reelPatternBootstrap")');
    expect(block).toContain("ensureHouseReelPatterns(database)");
    expect(block).toContain(".from(socialReelPatterns)");
    expect(block).toContain(".limit(100)");
  });
});
