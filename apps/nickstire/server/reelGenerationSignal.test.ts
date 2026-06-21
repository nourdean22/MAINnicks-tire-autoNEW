import { describe, it, expect } from "vitest";
import { pickTopThemes } from "./pipelines/instagram-data";

describe("pickTopThemes (Phase 5.4 feedback)", () => {
  it("ranks themes by frequency, most-frequent first", () => {
    const rows = [
      { themesJson: JSON.stringify(["promo", "seasonal"]) },
      { themesJson: JSON.stringify(["promo", "educational"]) },
      { themesJson: JSON.stringify(["promo"]) },
    ];
    expect(pickTopThemes(rows)).toEqual(["promo", "seasonal", "educational"]);
    expect(pickTopThemes(rows)[0]).toBe("promo");
  });

  it("skips the no-caption sentinel and tolerates bad/null JSON", () => {
    const rows = [
      { themesJson: "not json at all" },
      { themesJson: null },
      { themesJson: JSON.stringify(["no-caption", "brakes"]) },
    ];
    expect(pickTopThemes(rows)).toEqual(["brakes"]);
  });

  it("returns [] for empty input (no analytics data yet)", () => {
    expect(pickTopThemes([])).toEqual([]);
  });

  it("caps to the requested limit", () => {
    const rows = [{ themesJson: JSON.stringify(["a", "b", "c", "d", "e"]) }];
    expect(pickTopThemes(rows, 3)).toHaveLength(3);
  });
});
