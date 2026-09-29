import { describe, expect, it } from "vitest";
import {
  effectiveInvalidationAt,
  wasBelievedAt,
  wasEffectivelyTrueAt,
} from "@/lib/brain/memory-bitemporal";

const d = (iso: string) => new Date(iso);

describe("Q-31 BrainMemory bitemporal semantics", () => {
  it("separates corrected effective truth from what the system believed earlier", () => {
    const oldVersion = {
      createdAt: d("2026-01-10T00:00:00Z"),
      transactionFromAt: d("2026-01-10T00:00:00Z"),
      transactionExpiredAt: d("2026-02-01T00:00:00Z"),
      validFrom: d("2026-01-01T00:00:00Z"),
      validUntil: d("2026-01-05T00:00:00Z"),
    };
    const correctedVersion = {
      createdAt: d("2026-01-10T00:00:00Z"),
      transactionFromAt: d("2026-02-01T00:00:00Z"),
      transactionExpiredAt: null,
      validFrom: d("2026-01-05T00:00:00Z"),
      validUntil: null,
    };

    // Corrected-world truth: the new fact is effective from Jan 5.
    expect(wasEffectivelyTrueAt(oldVersion, d("2026-01-03T12:00:00Z"))).toBe(true);
    expect(wasEffectivelyTrueAt(oldVersion, d("2026-01-07T12:00:00Z"))).toBe(false);
    expect(wasEffectivelyTrueAt(correctedVersion, d("2026-01-07T12:00:00Z"))).toBe(true);

    // Belief history: StateNour did not learn the correction until Feb 1.
    expect(wasBelievedAt(oldVersion, d("2026-01-20T00:00:00Z"))).toBe(true);
    expect(wasBelievedAt(correctedVersion, d("2026-01-20T00:00:00Z"))).toBe(false);
    expect(wasBelievedAt(oldVersion, d("2026-02-02T00:00:00Z"))).toBe(false);
    expect(wasBelievedAt(correctedVersion, d("2026-02-02T00:00:00Z"))).toBe(true);
  });

  it("falls back to createdAt for legacy rows with no transaction start", () => {
    const legacy = {
      createdAt: d("2026-03-01T00:00:00Z"),
      transactionFromAt: null,
      transactionExpiredAt: null,
      validFrom: null,
      validUntil: null,
    };
    expect(wasBelievedAt(legacy, d("2026-02-28T23:59:59Z"))).toBe(false);
    expect(wasBelievedAt(legacy, d("2026-03-01T00:00:00Z"))).toBe(true);
  });

  it("clips an old effective interval only when the new start overlaps it", () => {
    const old = {
      createdAt: d("2026-01-10T00:00:00Z"),
      validFrom: d("2026-01-10T00:00:00Z"),
      validUntil: null,
    };
    expect(effectiveInvalidationAt(old, d("2026-01-20T00:00:00Z"))?.toISOString())
      .toBe("2026-01-20T00:00:00.000Z");
    expect(effectiveInvalidationAt(old, d("2026-01-05T00:00:00Z"))).toBeNull();
  });

  it("does not reopen or extend an interval that already ended", () => {
    const old = {
      createdAt: d("2026-01-01T00:00:00Z"),
      validFrom: d("2026-01-01T00:00:00Z"),
      validUntil: d("2026-01-10T00:00:00Z"),
    };
    expect(effectiveInvalidationAt(old, d("2026-01-15T00:00:00Z"))).toBeNull();
  });
});
