/**
 * Utility function tests — verify formatting, validation, and analytics helpers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("cn() utility", () => {
  it("merges class names correctly", async () => {
    const { cn } = await import("@/lib/utils");
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", async () => {
    const { cn } = await import("@/lib/utils");
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("merges tailwind classes without conflict", async () => {
    const { cn } = await import("@/lib/utils");
    // tw-merge should resolve conflicting padding
    const result = cn("px-4", "px-6");
    expect(result).toBe("px-6");
  });

  it("handles empty inputs", async () => {
    const { cn } = await import("@/lib/utils");
    expect(cn()).toBe("");
    expect(cn("")).toBe("");
    expect(cn(undefined, null, false)).toBe("");
  });
});

describe("trackPhoneClick() analytics", () => {
  beforeEach(() => {
    // Reset gtag mock before each test
    (globalThis as any).window = globalThis;
    delete (window as any).gtag;
  });

  it("calls gtag when available", async () => {
    const mockGtag = vi.fn();
    (window as any).gtag = mockGtag;

    const { trackPhoneClick } = await import("@/lib/analytics");
    trackPhoneClick("hero-cta");

    expect(mockGtag).toHaveBeenCalledWith(
      "event",
      "phone_call_click",
      expect.objectContaining({
        event_category: "conversion",
        event_label: "hero-cta",
      })
    );
  });

  it("does not throw when gtag is missing", async () => {
    delete (window as any).gtag;

    // Re-import to get fresh module
    const analytics = await import("@/lib/analytics");
    expect(() => analytics.trackPhoneClick("footer")).not.toThrow();
  });
});

describe("GA4 tracking functions", () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
    delete (window as any).gtag;
  });

  it("trackFormSubmission calls gtag with correct event", async () => {
    const mockGtag = vi.fn();
    (window as any).gtag = mockGtag;

    const { trackFormSubmission } = await import("@/lib/ga4");
    trackFormSubmission("booking", { service: "oil-change", source: "homepage" });

    expect(mockGtag).toHaveBeenCalledWith(
      "event",
      "form_submission_booking",
      expect.objectContaining({
        event_category: "form",
        form_type: "booking",
        service: "oil-change",
      })
    );
  });

  it("trackPhoneClick from ga4 calls gtag correctly", async () => {
    const mockGtag = vi.fn();
    (window as any).gtag = mockGtag;

    const { trackPhoneClick } = await import("@/lib/ga4");
    trackPhoneClick("header");

    expect(mockGtag).toHaveBeenCalledWith(
      "event",
      "phone_click",
      expect.objectContaining({
        event_category: "engagement",
        event_label: "header",
      })
    );
  });

  it("getTrafficSource returns 'direct' when no referrer", async () => {
    // jsdom has empty referrer by default
    const { getTrafficSource } = await import("@/lib/ga4");
    expect(getTrafficSource()).toBe("direct");
  });

  it("all GA4 functions are safe without gtag", async () => {
    delete (window as any).gtag;
    const ga4 = await import("@/lib/ga4");

    expect(() => ga4.trackFormSubmission("lead", {})).not.toThrow();
    expect(() => ga4.trackPhoneClick("test")).not.toThrow();
    expect(() => ga4.trackServiceView("brakes")).not.toThrow();
    expect(() => ga4.trackChatInteraction("start")).not.toThrow();
    expect(() => ga4.trackSearch("oil change")).not.toThrow();
    expect(() => ga4.trackPageView("/")).not.toThrow();
  });
});

describe("Shared constants integrity", () => {
  it("COOKIE_NAME is defined", async () => {
    const { COOKIE_NAME } = await import("@shared/const");
    expect(COOKIE_NAME).toBe("app_session_id");
  });

  it("STORE constants match BUSINESS constants", async () => {
    const { STORE_PHONE, STORE_ADDRESS, STORE_NAME } = await import("@shared/const");
    const { BUSINESS } = await import("@shared/business");

    expect(STORE_PHONE).toBe(BUSINESS.phone.display);
    expect(STORE_NAME).toBe(BUSINESS.name);
    expect(STORE_ADDRESS).toBe(BUSINESS.address.full);
  });

  it("GOOGLE_PLACE_ID is a valid format", async () => {
    const { GOOGLE_PLACE_ID } = await import("@shared/const");
    expect(GOOGLE_PLACE_ID).toBeTruthy();
    expect(GOOGLE_PLACE_ID.length).toBeGreaterThan(10);
  });
});
