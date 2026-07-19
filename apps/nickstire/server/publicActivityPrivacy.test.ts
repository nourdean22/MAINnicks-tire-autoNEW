/**
 * The public activity ticker must never publish a specific car.
 *
 * `activity.recent` is a publicProcedure (public.ts) and it rendered
 * `invoices.vehicleInfo` VERBATIM:
 *
 *   "A 2016 LINCOLN MKZ AWD just got front struts completed"  + minutesAgo
 *
 * Year + model + trim + drivetrain + an exact service + a timestamp, inside one
 * shop's catchment, describes one car closely enough that a neighbour could name
 * the owner. The booking branch twelve lines above already anonymised to
 * "Someone in {neighborhood}" — the completed-jobs branch never got the same
 * treatment.
 *
 * The strings below are REAL shapes measured from production `vehicleInfo`.
 */
import { describe, it, expect } from "vitest";
import { vehicleMake } from "./routers/public";

describe("only the make is ever published", () => {
  it.each([
    ["2016 LINCOLN MKZ AWD", "Lincoln"],
    ["2022 BMW * X3 SUV 4X4", "Bmw"],
    ["2014 DODGE * CARAVAN -GRAND CARAVAN", "Dodge"],
    ["2011 CADILLAC ESCALADE HYBRID", "Cadillac"],
    ["2020 CHEVROLET * BLAZER 4X4", "Chevrolet"],
    ["2004 MERCURY * MOUNTAINEER 4X4", "Mercury"],
    ["2018 MERCEDES C CLASS AWD", "Mercedes"],
    ["2009 FORD FUSION", "Ford"],
  ])("%s -> %s", (raw, expected) => {
    expect(vehicleMake(raw)).toBe(expected);
  });

  it("drops the model, the trim and the drivetrain — the identifying parts", () => {
    const out = vehicleMake("2016 LINCOLN MKZ AWD");
    for (const leaked of ["2016", "MKZ", "AWD"]) {
      expect(out).not.toContain(leaked);
    }
  });

  it("never echoes the raw string back, whatever it is given", () => {
    // The failure mode of a fallback here IS the leak, so an unparseable value
    // must degrade to a generic word rather than to the input.
    for (const weird of ["???", "12345", "-", "  ", "**", "2019"]) {
      expect(vehicleMake(weird)).toBe("vehicle");
    }
  });

  it("treats missing vehicle info as a vehicle, not as an empty sentence", () => {
    expect(vehicleMake(null)).toBe("vehicle");
    expect(vehicleMake(undefined)).toBe("vehicle");
    expect(vehicleMake("")).toBe("vehicle");
  });

  it("is idempotent — running it on its own output does not degrade", () => {
    expect(vehicleMake(vehicleMake("2016 LINCOLN MKZ AWD"))).toBe("Lincoln");
  });

  it("produces at most ONE word, so no model can survive by accident", () => {
    for (const raw of ["2018 MERCEDES C CLASS AWD", "2014 DODGE * CARAVAN -GRAND CARAVAN"]) {
      expect(vehicleMake(raw).split(/\s+/)).toHaveLength(1);
    }
  });
});

describe("the ticker still says something worth saying", () => {
  it("keeps the brand, which is what makes the activity feel real", () => {
    // The point of the ticker is "this shop is busy and works on real cars".
    // Stripping to "a vehicle" everywhere would be safe and useless.
    expect(vehicleMake("2022 BMW * X3 SUV 4X4")).not.toBe("vehicle");
  });
});
