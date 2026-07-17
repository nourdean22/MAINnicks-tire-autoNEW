/** Image-derived Visual Bible — pure extraction units (vision path proven
 *  live: evidence/observed-bible-660002.json from real 660002 frames). */
import { describe, expect, it } from "vitest";
import { extractBalancedJson } from "./services/visualBibleObserved";

describe("extractBalancedJson", () => {
  it("pulls the first balanced object out of fenced/padded text", () => {
    expect(extractBalancedJson('Sure! ```json\n{"a":{"b":1}}\n``` hope that helps')).toBe('{"a":{"b":1}}');
  });
  it("truncated JSON yields {} (honest-null upstream, never a fabricated bible)", () => {
    expect(extractBalancedJson('{"subject":"car","camera":{"angle":"high')).toBe("{}");
  });
  it("no object at all yields {}", () => {
    expect(extractBalancedJson("I cannot analyze these images.")).toBe("{}");
  });
});
