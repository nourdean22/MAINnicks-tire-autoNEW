import { describe, it, expect } from "vitest";
import { COLUMNS, GUARDED_SET, plateTextToStore } from "./cameraVisitsRoutes";

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

describe("camera visit ingest — the seq guard covers every column", () => {
  it("guards EVERY updatable column, so a new column cannot skip monotonicity", () => {
    // The invariant is enforced by the ON DUPLICATE KEY UPDATE clause, not by a
    // read-then-write, and it only holds if every assignment carries the guard. A
    // column added to COLUMNS without one would let a stale delivery overwrite that
    // single field while the rest of the row correctly refused it.
    const updatable = COLUMNS.filter((c) => c !== "visitId");
    for (const col of updatable) {
      expect(GUARDED_SET, `${col} is not seq-guarded`).toContain(
        `\`${col}\` = IF(VALUES(\`seq\`) >= \`seq\`, VALUES(\`${col}\`), \`${col}\`)`,
      );
    }
    expect(GUARDED_SET.split("IF(VALUES(`seq`)").length - 1).toBe(updatable.length);
  });

  it("never rewrites the key it matches on", () => {
    expect(GUARDED_SET).not.toContain("`visitId` =");
  });
});
