/**
 * UI v3 W3b round 3 (A4): the urgency word map behind the Decision inbox card. W3b replaced the raw
 * key in capitals (THIS_WEEK) with a sentence-case word; nothing pinned the map, so a reverted key
 * or a missing entry read as fine.
 */
import { describe, it, expect } from "vitest";
import { urgencyWord } from "@/components/chat/typed-cards";

describe("urgencyWord", () => {
  it.each([
    ["critical", "Critical"],
    ["today", "Today"],
    ["this_week", "This week"],
    ["later", "Later"],
  ])("%s reads %s", (key, word) => {
    expect(urgencyWord(key)).toBe(word);
  });

  it("no urgency reads Unranked, never an empty label", () => {
    expect(urgencyWord(undefined)).toBe("Unranked");
    expect(urgencyWord("")).toBe("Unranked");
  });

  it("an urgency the map does not know keeps its own words with the underscores gone, never capitals", () => {
    expect(urgencyWord("next_month")).toBe("next month");
    expect(urgencyWord("next_month")).not.toMatch(/[A-Z]{2,}/);
  });
});
