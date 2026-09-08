/**
 * tests/repo/phone-type-floor.test.ts · 2026-09-08 (program §5.1)
 *
 * The phone type floor lives in ONE media block in base.css. A refactor that
 * drops it, widens it to desktop, or lowers the floor fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "..", "app/styles/base.css"), "utf8");

describe("phone type floor", () => {
  const block = /@media \(max-width: 767px\) \{\s*\[class\*="text-\[9px\]"\] \{ font-size: (\d+)px !important; \}\s*\[class\*="text-\[10px\]"\] \{ font-size: (\d+)px !important; \}\s*\}/;
  it("raises 9px and 10px labels to at least 11px and 12px below md, and only below md", () => {
    const m = block.exec(css);
    expect(m, "floor block missing or reshaped").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(11);
    expect(Number(m![2])).toBeGreaterThanOrEqual(12);
  });
});
