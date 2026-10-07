/**
 * DVI measurement vocabulary — grading bands, formatting, schema, tolerant decode.
 * Every band is pinned at its boundary on BOTH sides, so a threshold typo
 * (>= vs >) fails here before it misgrades a brake job.
 */
import { describe, expect, it } from "vitest";
import {
  formatMeasurement,
  gradeMeasurement,
  inspectionMeasurementsSchema,
  metricsForCategory,
  normalizeMeasurements,
  normalizePhotoUrls,
  suggestCondition,
  MAX_ITEM_PHOTOS,
} from "./inspectionMeasurements";

/** The server validates arrays; one entry at a time reads better here. */
const inspectionMeasurementSchema = { safeParse: (v: unknown) => inspectionMeasurementsSchema.safeParse([v]) };

describe("gradeMeasurement · shop guidance bands", () => {
  it("tread depth: 6+ green, 3-5 yellow, 2 and under red", () => {
    expect(gradeMeasurement({ metric: "tread_depth_32nds", value: 6 })).toBe("green");
    expect(gradeMeasurement({ metric: "tread_depth_32nds", value: 5 })).toBe("yellow");
    expect(gradeMeasurement({ metric: "tread_depth_32nds", value: 3 })).toBe("yellow");
    expect(gradeMeasurement({ metric: "tread_depth_32nds", value: 2 })).toBe("red");
    expect(gradeMeasurement({ metric: "tread_depth_32nds", value: 0 })).toBe("red");
  });
  it("brake pads: 7+ green, 4-6 yellow, 3 and under red", () => {
    expect(gradeMeasurement({ metric: "brake_pad_mm", value: 7 })).toBe("green");
    expect(gradeMeasurement({ metric: "brake_pad_mm", value: 6.5 })).toBe("yellow");
    expect(gradeMeasurement({ metric: "brake_pad_mm", value: 4 })).toBe("yellow");
    expect(gradeMeasurement({ metric: "brake_pad_mm", value: 3 })).toBe("red");
  });
  it("rotor thickness grades only against its minimum spec", () => {
    expect(gradeMeasurement({ metric: "rotor_thickness_mm", value: 24 })).toBeNull();
    expect(gradeMeasurement({ metric: "rotor_thickness_mm", value: 24, spec: 22 })).toBe("green");
    expect(gradeMeasurement({ metric: "rotor_thickness_mm", value: 22.5, spec: 22 })).toBe("yellow");
    expect(gradeMeasurement({ metric: "rotor_thickness_mm", value: 22, spec: 22 })).toBe("red");
  });
  it("battery voltage: 12.4+ green, 12.0-12.39 yellow, below 12.0 red", () => {
    expect(gradeMeasurement({ metric: "battery_voltage", value: 12.4 })).toBe("green");
    expect(gradeMeasurement({ metric: "battery_voltage", value: 12.39 })).toBe("yellow");
    expect(gradeMeasurement({ metric: "battery_voltage", value: 12.0 })).toBe("yellow");
    expect(gradeMeasurement({ metric: "battery_voltage", value: 11.99 })).toBe("red");
  });
  it("battery CCA grades as a share of the rated value, or not at all", () => {
    expect(gradeMeasurement({ metric: "battery_cca", value: 500 })).toBeNull();
    expect(gradeMeasurement({ metric: "battery_cca", value: 500, spec: 0 })).toBeNull();
    expect(gradeMeasurement({ metric: "battery_cca", value: 480, spec: 600 })).toBe("green");
    expect(gradeMeasurement({ metric: "battery_cca", value: 420, spec: 600 })).toBe("yellow");
    expect(gradeMeasurement({ metric: "battery_cca", value: 300, spec: 600 })).toBe("red");
  });
  it("fluid condition maps good / fair / replace; pressure never grades alone", () => {
    expect(gradeMeasurement({ metric: "fluid_condition", value: "good", position: "coolant" })).toBe("green");
    expect(gradeMeasurement({ metric: "fluid_condition", value: "fair", position: "coolant" })).toBe("yellow");
    expect(gradeMeasurement({ metric: "fluid_condition", value: "replace", position: "coolant" })).toBe("red");
    expect(gradeMeasurement({ metric: "fluid_condition", value: "ok", position: "coolant" })).toBeNull();
    expect(gradeMeasurement({ metric: "tire_pressure_psi", value: 12, position: "LF" })).toBeNull();
  });
  it("a non-numeric value on a numeric metric is ungradable, not red", () => {
    expect(gradeMeasurement({ metric: "brake_pad_mm", value: "three" })).toBeNull();
    expect(gradeMeasurement({ metric: "brake_pad_mm", value: Number.NaN })).toBeNull();
  });
});

describe("suggestCondition · worst gradable measurement wins", () => {
  it("picks red over yellow over green and ignores ungradable entries", () => {
    expect(
      suggestCondition([
        { metric: "tread_depth_32nds", value: 8, position: "LF" },
        { metric: "tread_depth_32nds", value: 4, position: "RF" },
        { metric: "tire_pressure_psi", value: 30, position: "RF" },
      ]),
    ).toBe("yellow");
    expect(
      suggestCondition([
        { metric: "brake_pad_mm", value: 9, position: "front" },
        { metric: "brake_pad_mm", value: 2, position: "rear" },
      ]),
    ).toBe("red");
  });
  it("returns null when nothing can be graded", () => {
    expect(suggestCondition([])).toBeNull();
    expect(suggestCondition([{ metric: "tire_pressure_psi", value: 32, position: "LF" }])).toBeNull();
  });
});

describe("formatMeasurement · what the customer reads", () => {
  it("renders each metric in its own idiom", () => {
    expect(formatMeasurement({ metric: "tread_depth_32nds", value: 4, position: "LF" })).toBe('LF 4/32"');
    expect(formatMeasurement({ metric: "brake_pad_mm", value: 3, position: "front" })).toBe("Pads front 3 mm");
    expect(formatMeasurement({ metric: "rotor_thickness_mm", value: 22.1, position: "LF", spec: 22 })).toBe("Rotor LF 22.1 mm (min 22)");
    expect(formatMeasurement({ metric: "battery_voltage", value: 12.1 })).toBe("Battery 12.1 V");
    expect(formatMeasurement({ metric: "battery_cca", value: 410, spec: 600 })).toBe("Battery 410 CCA of 600 rated");
    expect(formatMeasurement({ metric: "fluid_condition", value: "replace", position: "coolant" })).toBe("Coolant: replace");
  });
});

describe("inspectionMeasurementSchema · what the server accepts", () => {
  it("accepts in-range numbers and known choices", () => {
    expect(inspectionMeasurementSchema.safeParse({ metric: "tread_depth_32nds", value: 7, position: "LR" }).success).toBe(true);
    expect(inspectionMeasurementSchema.safeParse({ metric: "fluid_condition", value: "fair", position: "brake fluid" }).success).toBe(true);
  });
  it("rejects out-of-range, wrong-type and unknown values", () => {
    expect(inspectionMeasurementSchema.safeParse({ metric: "tread_depth_32nds", value: 40 }).success).toBe(false);
    expect(inspectionMeasurementSchema.safeParse({ metric: "brake_pad_mm", value: "3" }).success).toBe(false);
    expect(inspectionMeasurementSchema.safeParse({ metric: "fluid_condition", value: "meh" }).success).toBe(false);
    expect(inspectionMeasurementSchema.safeParse({ metric: "wheel_bearing_noise", value: 1 }).success).toBe(false);
  });
  it("offers the right metrics per category", () => {
    expect(metricsForCategory("tires").map((s) => s.metric)).toEqual(["tread_depth_32nds", "tire_pressure_psi"]);
    expect(metricsForCategory("brakes").map((s) => s.metric)).toEqual(["brake_pad_mm", "rotor_thickness_mm"]);
    expect(metricsForCategory("body")).toEqual([]);
  });
});

describe("tolerant decode of the JSON columns", () => {
  it("drops entries that fail the schema and survives garbage", () => {
    expect(normalizeMeasurements([{ metric: "brake_pad_mm", value: 3 }, { metric: "brake_pad_mm", value: "bad" }, 42])).toEqual([
      { metric: "brake_pad_mm", value: 3 },
    ]);
    expect(normalizeMeasurements("not json")).toEqual([]);
    expect(normalizeMeasurements('[{"metric":"battery_voltage","value":12.6}]')).toEqual([{ metric: "battery_voltage", value: 12.6 }]);
    expect(normalizeMeasurements(null)).toEqual([]);
  });
  it("photo list falls back to the legacy single URL and caps the count", () => {
    expect(normalizePhotoUrls("https://x/a.jpg", null)).toEqual(["https://x/a.jpg"]);
    expect(normalizePhotoUrls("https://x/a.jpg", ["https://x/b.jpg", "https://x/c.jpg"])).toEqual(["https://x/b.jpg", "https://x/c.jpg"]);
    expect(normalizePhotoUrls(null, "[]")).toEqual([]);
    expect(normalizePhotoUrls(null, Array.from({ length: 12 }, (_, i) => `https://x/${i}.jpg`))).toHaveLength(MAX_ITEM_PHOTOS);
  });
});
