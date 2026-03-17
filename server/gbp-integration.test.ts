import { describe, it, expect } from "vitest";
import {
  GBP_PLACE_URL,
  GBP_DIRECTIONS_URL,
  GBP_REVIEW_URL,
  GBP_CID,
  GBP_EMBED_URL,
} from "@shared/const";

describe("Google Business Profile Integration", () => {
  it("should have a valid GBP Place URL", () => {
    expect(GBP_PLACE_URL).toBeDefined();
    expect(GBP_PLACE_URL).toContain("google.com/maps/place");
    expect(GBP_PLACE_URL).toContain("Nick");
    expect(GBP_PLACE_URL).toContain("41.5525118");
    expect(GBP_PLACE_URL).toContain("-81.5571875");
  });

  it("should have a valid GBP Directions URL", () => {
    expect(GBP_DIRECTIONS_URL).toBeDefined();
    expect(GBP_DIRECTIONS_URL).toContain("google.com/maps/dir");
    expect(GBP_DIRECTIONS_URL).toContain("17625+Euclid+Ave");
    expect(GBP_DIRECTIONS_URL).toContain("Cleveland");
  });

  it("should have a valid GBP Review URL with Place ID", () => {
    expect(GBP_REVIEW_URL).toBeDefined();
    expect(GBP_REVIEW_URL).toContain("search.google.com/local/writereview");
    expect(GBP_REVIEW_URL).toContain("placeid=");
    expect(GBP_REVIEW_URL).toContain("ChIJSWRRLdr_MEiRBZ3NBATPvQo");
  });

  it("should have a valid CID", () => {
    expect(GBP_CID).toBeDefined();
    expect(GBP_CID).toBe("913066080091298245");
    // CID should be a numeric string
    expect(/^\d+$/.test(GBP_CID)).toBe(true);
  });

  it("should have a valid Google Maps Embed URL", () => {
    expect(GBP_EMBED_URL).toBeDefined();
    expect(GBP_EMBED_URL).toContain("google.com/maps/embed");
    expect(GBP_EMBED_URL).toContain("41.5525118");
  });

  it("should have consistent coordinates across all URLs", () => {
    // Both Place URL and Embed URL should reference the same location
    expect(GBP_PLACE_URL).toContain("41.5525118");
    expect(GBP_PLACE_URL).toContain("-81.5571875");
    expect(GBP_EMBED_URL).toContain("41.5525118");
  });

  it("should have all required social profile URLs for sameAs", () => {
    // These are the URLs that should appear in structured data sameAs arrays
    const requiredSameAs = [
      "https://www.google.com/maps/place/Nick",
      "https://www.instagram.com/nicks_tire_euclid/",
      "https://www.facebook.com/nickstireeuclid/",
    ];

    // Verify the GBP Place URL is a valid sameAs entry
    expect(GBP_PLACE_URL).toContain(requiredSameAs[0]);
  });

  it("should have correct business address in directions URL", () => {
    expect(GBP_DIRECTIONS_URL).toContain("17625+Euclid+Ave");
    expect(GBP_DIRECTIONS_URL).toContain("Cleveland");
    expect(GBP_DIRECTIONS_URL).toContain("OH");
    expect(GBP_DIRECTIONS_URL).toContain("44112");
  });
});
