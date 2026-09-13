import { describe, expect, it } from "vitest";
import { specificityDensity } from "@/lib/ai/nour-voice-profile";
import { checkSpecificityMarkerDensity } from "@/lib/ai/evals/quality-bench-core";
import { QUALITY_PROMPTS } from "@/tests/fixtures/quality-prompts.gold";

describe("quality bench specificity semantics", () => {
  it("uses the same marker-density value as the production critic", () => {
    const output = "Nick closed 3 estimates today for $2,400.";
    const density = specificityDensity(output);
    const result = checkSpecificityMarkerDensity(output, 2);

    expect(density).toBeGreaterThan(2);
    expect(result.pass).toBe(true);
    expect(result.detail).toContain(density.toFixed(2));
    expect(result.check).toBe("minSpecificityMarkerDensity");
  });

  it("does not reward generic capitalization as specificity", () => {
    // The retired bench proxy counted capitalized tokens and would inflate this
    // despite there being no number, named system/person, date, path, id, etc.
    const output = "This Generic Sentence Uses Many Capitalized Words But Gives Vague Advice Only.";
    const density = specificityDensity(output);
    const result = checkSpecificityMarkerDensity(output, 0.5);

    expect(density).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("0.00/100w");
  });

  it("the gold registry no longer carries the legacy lexical-percentage key", () => {
    const serialized = JSON.stringify(QUALITY_PROMPTS);
    expect(serialized).not.toContain("minSpecDensity");

    const brief = QUALITY_PROMPTS.find((p) => p.id === "summary-morning-brief");
    expect(brief?.checks.minSpecificityMarkerDensity).toBe(2);
  });
});
