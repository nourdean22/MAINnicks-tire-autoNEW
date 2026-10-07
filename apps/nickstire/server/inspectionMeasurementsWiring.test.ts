/**
 * DVI 0143 is WIRED, not just written (2026-10-07).
 *
 *  - Writes: the value builder attaches the 0143 keys only when supplied, so
 *    pre-0143 call sites emit byte-identical SQL, and mirrors the first photo.
 *  - Reads: the row decoder tolerates pre-0143 rows and garbage JSON.
 *  - Router: addItem / updateItem validate measurements through the shared
 *    schema; verifyItem exists and is admin-only (not in the public list).
 *  - Queue: a verified item is completed work, never a deferral.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/db-helper", () => ({ db: async () => null }));

import { buildInspectionItemValues, viewInspectionItem } from "./db";
import { inspectionRouter } from "./routers/services";
import { summarizeInspectionForQueue } from "./services/opportunityQueue";

describe("buildInspectionItemValues", () => {
  it("emits the pre-0143 shape when no 0143 field is supplied", () => {
    const v = buildInspectionItemValues({ inspectionId: 1, component: "Front pads", category: "brakes", condition: "red", photoUrl: "https://x/a.jpg" });
    expect("measurementsJson" in v).toBe(false);
    expect("photoUrlsJson" in v).toBe(false);
    expect(v.photoUrl).toBe("https://x/a.jpg");
  });
  it("stores the photo list and mirrors the first photo into photoUrl", () => {
    const v = buildInspectionItemValues({ inspectionId: 1, component: "Front pads", category: "brakes", condition: "red", photoUrls: ["https://x/1.jpg", "https://x/2.jpg"] });
    expect(v.photoUrlsJson).toEqual(["https://x/1.jpg", "https://x/2.jpg"]);
    expect(v.photoUrl).toBe("https://x/1.jpg");
  });
  it("keeps an explicit photoUrl over the mirror and stores measurements", () => {
    const v = buildInspectionItemValues({ photoUrl: "https://x/cover.jpg", photoUrls: ["https://x/1.jpg"], measurements: [{ metric: "brake_pad_mm", value: 3, position: "front" }] });
    expect(v.photoUrl).toBe("https://x/cover.jpg");
    expect(v.measurementsJson).toEqual([{ metric: "brake_pad_mm", value: 3, position: "front" }]);
  });
  it("an empty list attaches nothing", () => {
    const v = buildInspectionItemValues({ measurements: [], photoUrls: [] });
    expect(Object.keys(v)).toEqual([]);
  });
});

describe("viewInspectionItem", () => {
  const base = {
    id: 7, inspectionId: 1, component: "Front pads", category: "brakes" as const, condition: "red" as const,
    notes: null, photoUrl: "https://x/a.jpg", recommendedAction: null, estimatedCost: 240,
    decision: "approved", decisionAt: null, customerNote: null, sortOrder: 0, createdAt: new Date("2026-10-01T12:00:00Z"),
  };
  it("a pre-0143 row decodes to no measurements, the legacy photo, no verification", () => {
    const v = viewInspectionItem({ ...base, measurementsJson: null, photoUrlsJson: null, verifiedAt: null, verifiedBy: null, verificationNote: null, verificationPhotoUrlsJson: null, verificationMeasurementsJson: null });
    expect(v.measurements).toEqual([]);
    expect(v.photoUrls).toEqual(["https://x/a.jpg"]);
    expect(v.verification).toBeNull();
  });
  it("a verified row carries the after evidence", () => {
    const v = viewInspectionItem({
      ...base,
      measurementsJson: [{ metric: "brake_pad_mm", value: 3, position: "front" }],
      photoUrlsJson: ["https://x/1.jpg", "https://x/2.jpg"],
      verifiedAt: new Date("2026-10-03T15:00:00Z"), verifiedBy: "Joe", verificationNote: "New pads and rotors",
      verificationPhotoUrlsJson: ["https://x/after.jpg"],
      verificationMeasurementsJson: [{ metric: "brake_pad_mm", value: 11, position: "front" }],
    });
    expect(v.photoUrls).toHaveLength(2);
    expect(v.verification?.verifiedBy).toBe("Joe");
    expect(v.verification?.photoUrls).toEqual(["https://x/after.jpg"]);
    expect(v.verification?.measurements).toEqual([{ metric: "brake_pad_mm", value: 11, position: "front" }]);
  });
  it("garbage JSON in either column cannot crash the customer page", () => {
    const v = viewInspectionItem({ ...base, measurementsJson: "{nope", photoUrlsJson: 12, verifiedAt: "not a date" as unknown as Date, verifiedBy: null, verificationNote: null, verificationPhotoUrlsJson: null, verificationMeasurementsJson: null });
    expect(v.measurements).toEqual([]);
    expect(v.photoUrls).toEqual(["https://x/a.jpg"]);
    expect(v.verification).toBeNull();
  });
});

describe("inspectionRouter · 0143 procedures", () => {
  const procedures = inspectionRouter._def.procedures as Record<string, { _def: { inputs: Array<{ safeParse: (v: unknown) => { success: boolean } }> } }>;
  it("verifyItem is registered and rejects an unknown metric", () => {
    expect(procedures.verifyItem).toBeDefined();
    const input = procedures.verifyItem._def.inputs[0];
    expect(input.safeParse({ id: 1, verifiedBy: "Joe", measurements: [{ metric: "brake_pad_mm", value: 11, position: "front" }] }).success).toBe(true);
    expect(input.safeParse({ id: 1, verifiedBy: "Joe", measurements: [{ metric: "vibes", value: 11 }] }).success).toBe(false);
    expect(input.safeParse({ id: 1, verifiedBy: "" }).success).toBe(false);
  });
  it("addItem rejects an out-of-range measurement and more than 8 photos", () => {
    const input = procedures.addItem._def.inputs[0];
    const ok = { inspectionId: 1, component: "LF tire", category: "tires", condition: "yellow" };
    expect(input.safeParse({ ...ok, measurements: [{ metric: "tread_depth_32nds", value: 4, position: "LF" }] }).success).toBe(true);
    expect(input.safeParse({ ...ok, measurements: [{ metric: "tread_depth_32nds", value: 40, position: "LF" }] }).success).toBe(false);
    expect(input.safeParse({ ...ok, photoUrls: Array.from({ length: 9 }, (_, i) => `https://x/${i}.jpg`) }).success).toBe(false);
  });
});

describe("summarizeInspectionForQueue · verified work is not a deferral", () => {
  it("a verified red item with no decision no longer counts as open", () => {
    const s = summarizeInspectionForQueue([
      { condition: "red", decision: null, estimatedCost: 400, verifiedAt: new Date("2026-10-05T12:00:00Z") },
      { condition: "yellow", decision: "declined", estimatedCost: 150, verifiedAt: null },
    ]);
    expect(s.openFlagged).toBe(1);
    expect(s.redOpen).toBe(0);
    expect(s.valueCents).toBe(15_000);
    expect(s.urgency).toBe("this_week");
  });
});
