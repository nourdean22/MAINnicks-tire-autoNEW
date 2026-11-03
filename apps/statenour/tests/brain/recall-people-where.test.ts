/**
 * W8a (audit C11): recall's people block used to read ANY 30 profiles, deleted ones included, then filter by name in
 * JS. The filter is SQL now: live rows only, matched on the topics and their 4+ letter words; no term, no read.
 */
import { describe, expect, it } from "vitest";

import { recallPeopleWhere } from "@/lib/brain/contextual-recall";

describe("recallPeopleWhere", () => {
  it("live rows only, matched case-insensitively on each topic and its longer words, in name or relationship", () => {
    const where = recallPeopleWhere(["sam", "the brake job"]);
    expect(where).toMatchObject({ deletedAt: null });
    const or = (where as { OR: Array<Record<string, unknown>> }).OR;
    const terms = or.map((c) => JSON.stringify(c));
    expect(terms).toContainEqual(JSON.stringify({ name: { contains: "sam", mode: "insensitive" } }));
    expect(terms).toContainEqual(JSON.stringify({ relationship: { contains: "sam", mode: "insensitive" } }));
    expect(terms).toContainEqual(JSON.stringify({ name: { contains: "brake", mode: "insensitive" } }));
    expect(terms.some((t) => t.includes('"the"'))).toBe(false); // words of 3 letters or fewer are not terms
  });

  it("no term means no read", () => {
    expect(recallPeopleWhere([])).toBeNull();
    expect(recallPeopleWhere(["ok", "go"])).toBeNull();
  });

  it("the same term twice is one clause", () => {
    const or = (recallPeopleWhere(["sam", "Sam"]) as { OR: unknown[] }).OR;
    expect(or).toHaveLength(2);
  });
});
