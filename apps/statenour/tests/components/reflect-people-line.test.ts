/**
 * W8b manager round 1, item 5 · the composer toast tells a failed people link from a line that named no one.
 * Null or missing is "couldn't link"; an empty list says nothing; a name says who the entry reached.
 */
import { describe, expect, it } from "vitest";

import { reflectPeopleLine } from "@/components/journal/reflect-people-line";

describe("reflectPeopleLine", () => {
  it("null or missing: couldn't link", () => {
    expect(reflectPeopleLine(null)).toBe(" · People: couldn't link");
    expect(reflectPeopleLine(undefined)).toBe(" · People: couldn't link");
  });
  it("no names: nothing", () => {
    expect(reflectPeopleLine({ names: [] })).toBe("");
  });
  it("names: says them", () => {
    expect(reflectPeopleLine({ names: ["Dania", "Mo"] })).toBe(" · People: Dania, Mo");
  });
});
