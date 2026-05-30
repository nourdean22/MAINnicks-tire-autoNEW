/**
 * Rule-based attribution tests · 2026-05-30 · the free, deterministic
 * half of the rep-detector (habit category → stat). The AI half is
 * integration-tested via the live backfill.
 */
import { describe, it, expect } from "vitest";
import { attributeHabit } from "@/lib/mastery/attribution";

describe("attributeHabit · habit category → stat", () => {
  it("maps physical habits to the physical stat", () => {
    expect(attributeHabit("workout")).toBe("physical");
    expect(attributeHabit("water_intake")).toBe("physical");
  });
  it("maps a business habit to business_ops", () => {
    expect(attributeHabit("estimate_followup")).toBe("business_ops");
  });
  it("maps a marketing habit to marketing", () => {
    expect(attributeHabit("instagram_post")).toBe("marketing");
  });
  it("returns null for an unknown habit key", () => {
    expect(attributeHabit("does_not_exist")).toBeNull();
  });
});
