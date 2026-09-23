/**
 * Demand extraction — the spoken-tire-size problem, pinned.
 *
 * The cases that matter are the SPOKEN ones. A parser that handles "215/60R17"
 * and nothing else looks correct in review and drops most real phone calls,
 * because nobody says slashes out loud.
 *
 * The governing bias throughout: a wrong size is worse than no size. Every
 * ambiguous or out-of-range input must yield null, not a guess.
 */
import { describe, expect, it } from "vitest";

import {
  extractCondition,
  extractDemand,
  extractQuantity,
  extractTireSize,
  extractUrgency,
  extractVehicle,
  spokenNumbersToDigits,
} from "./callDemandExtraction";

describe("tire size · written forms", () => {
  const CASES: Array<[string, string]> = [
    ["I need 215/60R17", "215/60R17"],
    ["looking for 225/65R17 tires", "225/65R17"],
    ["do you have 215/60/17", "215/60R17"],
    ["size is 215-60-17", "215/60R17"],
    ["P215/60R17 please", "215/60R17"],
    ["LT265/70R17", "265/70R17"],
    ["215 60 17", "215/60R17"],
    ["215 60 R 17", "215/60R17"],
    ["it's a 235/65R18 on the back", "235/65R18"],
  ];
  for (const [input, expected] of CASES) {
    it(`${input} -> ${expected}`, () => {
      expect(extractTireSize(input)).toBe(expected);
    });
  }
});

describe("tire size · SPOKEN forms (what transcripts actually contain)", () => {
  const CASES: Array<[string, string]> = [
    ["two fifteen sixty seventeen", "215/60R17"],
    ["two twenty five sixty five seventeen", "225/65R17"],
    ["I need two fifteen sixty R seventeen", "215/60R17"],
    ["two thirty five sixty five eighteen", "235/65R18"],
    ["one ninety five sixty five fifteen", "195/65R15"],
    ["two sixty five seventy seventeen", "265/70R17"],
    // Production transcript 2026-09-22 (verbatim, carries no PII): the caller read
    // the width DIGIT BY DIGIT and the call recorded tireSize null. Recall on the
    // post-deploy slice was 3 sizes captured of 4 spoken; this was the fourth.
    ["tire size is two two five fifty r 18", "225/50R18"],
    ["two one five sixty seventeen", "215/60R17"],
  ];
  for (const [input, expected] of CASES) {
    it(`"${input}" -> ${expected}`, () => {
      expect(extractTireSize(input)).toBe(expected);
    });
  }

  it("NEGATIVE CONTROL: three spoken singles with no aspect after them are NOT a width", () => {
    // Also a real first turn from the same slice: "I need two two tires." A joiner
    // that fused any three singles would read a quantity as a size.
    expect(extractTireSize("I need two two tires")).toBeNull();
    expect(extractTireSize("two two five")).toBeNull();
  });

  it("the word-to-digit step is itself correct", () => {
    expect(spokenNumbersToDigits("two fifteen sixty seventeen")).toContain("15");
    expect(spokenNumbersToDigits("sixty five")).toContain("65");
    expect(spokenNumbersToDigits("sixty")).toContain("60");
  });
});

describe("tire size · refuses rather than guesses", () => {
  const NULLS = [
    "I need some tires",
    "how much for an oil change",
    "my car is a 2015",           // a bare year is not a size
    "call me at 216 555 1043",    // a phone number is not a size
    "999/99R99",                  // out of every plausible range
    "I paid 215 dollars last time",
    "",
  ];
  for (const input of NULLS) {
    it(`null for: "${input}"`, () => {
      expect(extractTireSize(input)).toBeNull();
    });
  }

  it("POSITIVE CONTROL: the same assertions pass a real size", () => {
    // Without this, a parser that returned null for EVERYTHING would score
    // green on the block above.
    expect(extractTireSize("215/60R17")).toBe("215/60R17");
  });
});

describe("quantity", () => {
  it.each([
    ["I need two tires", 2],
    ["can I get four tires", 4],
    ["just one tire", 1],
    ["a pair of used tires", 2],
    ["all four", 4],
    ["I need a full set", 4],
    ["I need two", 2],
  ])("%s -> %i", (input, expected) => {
    expect(extractQuantity(input as string)).toBe(expected);
  });

  it("returns null when unstated", () => {
    expect(extractQuantity("do you have any tires")).toBeNull();
  });
});

describe("condition", () => {
  it("reads used and new", () => {
    expect(extractCondition("looking for used tires")).toBe("used");
    expect(extractCondition("I want brand new ones")).toBe("new");
    expect(extractCondition("something cheaper")).toBe("used");
  });

  it("refuses when the caller said BOTH — a human decides", () => {
    expect(extractCondition("used or new, whatever you have")).toBeNull();
  });

  it("refuses when neither was said", () => {
    expect(extractCondition("I need a tire")).toBeNull();
  });
});

describe("vehicle", () => {
  it("captures year, make and model", () => {
    expect(extractVehicle("it's a 2023 Honda HR-V")).toBe("2023 Honda HR-V");
    expect(extractVehicle("2018 Chevy Malibu")).toBe("2018 Chevy Malibu");
  });

  it("captures make alone when no year was given", () => {
    expect(extractVehicle("my Toyota needs tires")).toBe("Toyota");
  });

  it("does not invent a model from a stopword", () => {
    expect(extractVehicle("my Honda needs tires")).toBe("Honda");
  });

  it("a bare year is not a vehicle", () => {
    expect(extractVehicle("I bought them in 2019")).toBeNull();
  });

  it("does not read a vehicle out of the shop's own address", () => {
    expect(extractVehicle("I'm near Euclid Ave")).toBeNull();
  });
});

describe("urgency", () => {
  it.each([
    ["I need them today", "today"],
    ["can I come tomorrow", "this_week"],
    ["I'm on my way", "today"],
    ["no rush", "flexible"],
  ])("%s -> %s", (input, expected) => {
    expect(extractUrgency(input as string)).toBe(expected);
  });
});

describe("extractDemand · the whole call", () => {
  it("reads a realistic spoken tire call", () => {
    const turns = [
      "yeah hi, I'm looking for two used tires",
      "two fifteen sixty seventeen",
      "it's for my 2023 Honda HR-V",
      "I need them today if you got em",
    ];
    const d = extractDemand(turns);
    expect(d.tireSize).toBe("215/60R17");
    expect(d.quantity).toBe(2);
    expect(d.condition).toBe("used");
    expect(d.vehicle).toBe("2023 Honda HR-V");
    expect(d.urgency).toBe("today");
    expect(d.hasCapturedSpecifics).toBe(true);
  });

  it("a repair call yields no tire specifics and says so", () => {
    const d = extractDemand(["my brakes are grinding", "it's a 2018 Malibu"]);
    expect(d.tireSize).toBeNull();
    expect(d.hasCapturedSpecifics).toBe(false);
  });

  it("an empty call extracts nothing and claims nothing", () => {
    const d = extractDemand([]);
    expect(d.hasCapturedSpecifics).toBe(false);
    expect(d.tireSize).toBeNull();
    expect(d.vehicle).toBeNull();
  });

  it("never throws on hostile input", () => {
    for (const turns of [[""], ["///"], ["1".repeat(500)], ["null undefined NaN"]]) {
      expect(() => extractDemand(turns)).not.toThrow();
    }
  });
});
