/**
 * Round 1 P1-6 (manager, 2026-11-03): a goal whose weekly-completes read failed (loopsThisWeek null) is not
 * "decaying": the read that would prove it went quiet did not answer. An absent field keeps the old meaning (0).
 */
import { describe, expect, it } from "vitest";

import { classifyStaleness } from "@/lib/brain/goal-staleness";

const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
const base = { id: "g1", title: "Goal", createdAt: old, updatedAt: old, progress: 40, currentValue: 4, status: "active", linkedActiveCount: 1, linkedDoneCount: 1 };

describe("classifyStaleness · loopsThisWeek", () => {
  it("CONTROL: a measured zero on an untouched goal reads decaying", () => {
    expect(classifyStaleness({ ...base, loopsThisWeek: 0 }).kind).toBe("decaying");
  });
  it("an unknown weekly count (null) is never read as zero", () => {
    expect(classifyStaleness({ ...base, loopsThisWeek: null }).kind).not.toBe("decaying");
  });
});
