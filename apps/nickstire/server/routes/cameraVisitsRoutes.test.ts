import { describe, it, expect } from "vitest";
import { plateTextToStore } from "./cameraVisitsRoutes";

describe("camera visit ingest — plate durability", () => {
  it("stores plate text ONLY when the read is CONFIRMED", () => {
    expect(plateTextToStore("CONFIRMED", "abc 1234")).toBe("ABC1234");
  });

  it("drops the text for every unproven status but keeps the status itself", () => {
    // An unproven string persisted to a database becomes a fact in someone's
    // head, and a wrong plate attaches the wrong customer's history to a car.
    for (const status of ["CANDIDATE", "AMBIGUOUS", "UNREADABLE", "NONE"]) {
      expect(plateTextToStore(status, "ABC1234"), status).toBeNull();
    }
  });

  it("normalizes a confirmed read so lookups compare on one key", () => {
    expect(plateTextToStore("CONFIRMED", "  abc-1234 ")).toBe("ABC1234");
  });

  it("a confirmed status with no usable text is null, not an empty string", () => {
    expect(plateTextToStore("CONFIRMED", "")).toBeNull();
    expect(plateTextToStore("CONFIRMED", null)).toBeNull();
    expect(plateTextToStore("CONFIRMED", "---")).toBeNull();
  });
});
