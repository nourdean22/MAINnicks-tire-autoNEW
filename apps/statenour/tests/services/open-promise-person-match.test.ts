import { describe, expect, it } from "vitest";
import { legacyPromisePersonMatchWhere } from "@/lib/services/people/open-promise-person-match";

describe("legacyPromisePersonMatchWhere", () => {
  it("limits name and nickname text fallbacks to tasks without a person link", () => {
    const where = legacyPromisePersonMatchWhere(
      { id: "y", name: "Yummah", metadata: { nicknames: ["mom"] } },
      [{ id: "y", name: "Yummah", metadata: { nicknames: ["mom"] } }],
    );

    expect(where).toEqual({
      personId: null,
      OR: [
        { promiseTo: { equals: "Yummah", mode: "insensitive" } },
        { promiseTo: { equals: "mom", mode: "insensitive" } },
      ],
    });
  });

  it("does not add a text fallback when there is no safe name or nickname", () => {
    expect(legacyPromisePersonMatchWhere({ id: "y", name: "Y" }, [{ id: "y", name: "Y" }])).toBeNull();
  });
});
