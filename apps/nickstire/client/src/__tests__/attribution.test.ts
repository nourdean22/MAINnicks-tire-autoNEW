/**
 * Unit tests for normalizePathname — the pure helper behind booking-page
 * aggregation (trafficFunnel.topBookingPages) and lead attribution chips.
 * landingPage stores FULL hrefs; grouping without normalization fragments
 * counts per UTM variant. These tests pin that contract.
 */
import { describe, it, expect } from "vitest";
import { normalizePathname } from "@shared/attribution";

describe("normalizePathname", () => {
  it("strips origin + query + hash from a full href", () => {
    expect(normalizePathname("https://nickstire.org/brakes?utm_source=google&utm_campaign=x#top")).toBe("/brakes");
  });

  it("two UTM variants of the same page normalize identically (no count fragmentation)", () => {
    const a = normalizePathname("https://nickstire.org/used-tires-cleveland?utm_source=google");
    const b = normalizePathname("https://nickstire.org/used-tires-cleveland?utm_source=facebook&utm_medium=cpc");
    expect(a).toBe("/used-tires-cleveland");
    expect(a).toBe(b);
  });

  it("homepage href normalizes to /", () => {
    expect(normalizePathname("https://nickstire.org/")).toBe("/");
    expect(normalizePathname("https://nickstire.org")).toBe("/");
  });

  it("handles bare paths with query strings", () => {
    expect(normalizePathname("/contact?ref=footer")).toBe("/contact");
    expect(normalizePathname("/")).toBe("/");
  });

  it("returns null for null/empty/whitespace", () => {
    expect(normalizePathname(null)).toBeNull();
    expect(normalizePathname(undefined)).toBeNull();
    expect(normalizePathname("")).toBeNull();
    expect(normalizePathname("   ")).toBeNull();
  });

  it("returns null for non-URL junk instead of fabricating a path", () => {
    expect(normalizePathname("hero")).toBeNull();
  });

  it("best-efforts protocol-less host values", () => {
    expect(normalizePathname("nickstire.org/tires")).toBe("/tires");
  });
});
