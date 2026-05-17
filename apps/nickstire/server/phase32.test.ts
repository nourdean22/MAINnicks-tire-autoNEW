/**
 * Phase 32 — Infrastructure, Fixes & Hardening Tests
 * Tests for: sanitization, Place ID unification, error formatting, customers router
 */
import { describe, it, expect } from "vitest";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "./sanitize";
import { GOOGLE_PLACE_ID, GBP_REVIEW_URL } from "../shared/const";

describe("Input Sanitization", () => {
  describe("sanitizeText", () => {
    it("strips HTML tags", () => {
      expect(sanitizeText("<script>alert('xss')</script>Hello")).toBe("alert('xss')Hello");
    });

    it("removes angle brackets", () => {
      expect(sanitizeText("test<>value")).toBe("testvalue");
    });

    it("removes javascript: protocol", () => {
      expect(sanitizeText("javascript:alert(1)")).toBe("alert(1)");
    });

    it("removes inline event handlers", () => {
      expect(sanitizeText("test onerror=alert(1)")).toBe("test");
    });

    it("handles null and undefined", () => {
      expect(sanitizeText(null)).toBe("");
      expect(sanitizeText(undefined)).toBe("");
    });

    it("trims whitespace", () => {
      expect(sanitizeText("  hello world  ")).toBe("hello world");
    });

    it("passes clean text through unchanged", () => {
      expect(sanitizeText("John Smith")).toBe("John Smith");
      expect(sanitizeText("2015 Honda Civic")).toBe("2015 Honda Civic");
      expect(sanitizeText("Check engine light is on, car shaking")).toBe("Check engine light is on, car shaking");
    });
  });

  describe("sanitizePhone", () => {
    it("allows valid phone characters", () => {
      expect(sanitizePhone("(216) 862-0005")).toBe("(216) 862-0005");
      expect(sanitizePhone("+1-216-862-0005")).toBe("+1-216-862-0005");
    });

    it("strips non-phone characters", () => {
      expect(sanitizePhone("216<script>862")).toBe("216862");
    });

    it("handles null and undefined", () => {
      expect(sanitizePhone(null)).toBe("");
      expect(sanitizePhone(undefined)).toBe("");
    });
  });

  describe("sanitizeEmail", () => {
    it("lowercases and trims email", () => {
      expect(sanitizeEmail("  John@Example.COM  ")).toBe("john@example.com");
    });

    it("strips dangerous characters", () => {
      expect(sanitizeEmail("test'\"<>@email.com")).toBe("test@email.com");
    });

    it("handles null and undefined", () => {
      expect(sanitizeEmail(null)).toBe("");
      expect(sanitizeEmail(undefined)).toBe("");
    });
  });
});

describe("Place ID Unification", () => {
  it("exports a single verified Place ID", () => {
    expect(GOOGLE_PLACE_ID).toBeDefined();
    expect(GOOGLE_PLACE_ID).toMatch(/^ChIJ/);
  });

  it("exports a valid Google Review URL", () => {
    expect(GBP_REVIEW_URL).toBeDefined();
    expect(GBP_REVIEW_URL).toContain("search.google.com/local/writereview");
    expect(GBP_REVIEW_URL).toContain(GOOGLE_PLACE_ID);
  });
});
