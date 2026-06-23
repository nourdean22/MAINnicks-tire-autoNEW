import { describe, it, expect, vi } from "vitest";
import { getAuthUrl, getAuthenticatedClient } from "../auth";
import { compileGbpPost } from "../post";

describe("GBP Publisher - Auth Helper", () => {
  it("should generate a valid Google OAuth consent URL", () => {
    const url = getAuthUrl({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      redirectUri: "http://localhost/callback",
      state: "random-state"
    });

    expect(url).toContain("accounts.google.com");
    expect(url).toContain("client_id=test-client-id");
    expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%2Fcallback");
    expect(url).toContain("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fbusiness.manage");
    expect(url).toContain("state=random-state");
  });

  it("should initialize pre-authenticated client correctly", () => {
    const client = getAuthenticatedClient({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      refreshToken: "test-refresh-token"
    });

    expect(client).toBeDefined();
    expect(client.credentials.refresh_token).toBe("test-refresh-token");
  });
});

describe("GBP Publisher - Post Compiler", () => {
  it("should compile standard local post payload", () => {
    const compiled = compileGbpPost({
      topicType: "STANDARD",
      summary: "This is a local update from the shop.",
      callToAction: {
        actionType: "LEARN_MORE",
        url: "https://nickstire.org"
      },
      media: [
        {
          mediaFormat: "PHOTO",
          sourceUrl: "https://nickstire.org/images/shop.jpg"
        }
      ]
    });

    expect(compiled.topicType).toBe("STANDARD");
    expect(compiled.summary).toBe("This is a local update from the shop.");
    expect(compiled.callToAction.actionType).toBe("LEARN_MORE");
    expect(compiled.callToAction.url).toBe("https://nickstire.org");
    expect(compiled.media).toHaveLength(1);
    expect(compiled.media[0].sourceUrl).toBe("https://nickstire.org/images/shop.jpg");
  });

  it("should allow CALL CTA type without requiring url field", () => {
    const compiled = compileGbpPost({
      topicType: "STANDARD",
      summary: "Call us today!",
      callToAction: {
        actionType: "CALL"
      }
    });

    expect(compiled.callToAction.actionType).toBe("CALL");
    expect(compiled.callToAction.url).toBeUndefined();
  });

  it("should compile event post payload with title and dates", () => {
    const compiled = compileGbpPost({
      topicType: "EVENT",
      summary: "Grand reopening event!",
      event: {
        title: "Grand Reopening",
        schedule: {
          startDate: { year: 2026, month: 7, day: 1 },
          endDate: { year: 2026, month: 7, day: 2 }
        }
      }
    });

    expect(compiled.topicType).toBe("EVENT");
    expect(compiled.event.title).toBe("Grand Reopening");
    expect(compiled.event.schedule.startDate.day).toBe(1);
    expect(compiled.event.schedule.endDate.day).toBe(2);
  });

  it("should compile offer post payload with coupon details", () => {
    const compiled = compileGbpPost({
      topicType: "OFFER",
      summary: "Get 20% off all alignments this week!",
      event: {
        title: "Alignment Special",
        schedule: {
          startDate: { year: 2026, month: 7, day: 1 },
          endDate: { year: 2026, month: 7, day: 7 }
        }
      },
      offer: {
        couponCode: "ALIGN20",
        redeemOnlineUrl: "https://nickstire.org/specials",
        termsAndConditions: "Limit one per vehicle."
      }
    });

    expect(compiled.topicType).toBe("OFFER");
    expect(compiled.offer.couponCode).toBe("ALIGN20");
    expect(compiled.offer.termsAndConditions).toBe("Limit one per vehicle.");
  });

  it("should explicitly reject PRODUCT topicType", () => {
    expect(() => {
      compileGbpPost({
        topicType: "PRODUCT",
        summary: "Brand new Michelin tire in stock!"
      });
    }).toThrow(/programmatically supported/);
  });

  it("should reject CTA kinds requiring url when url is missing", () => {
    expect(() => {
      compileGbpPost({
        topicType: "STANDARD",
        callToAction: {
          actionType: "LEARN_MORE"
        }
      });
    }).toThrow(/requires a URL/);
  });

  it("should reject event post missing schedule or title details", () => {
    expect(() => {
      compileGbpPost({
        topicType: "EVENT",
        event: {
          title: "" // Empty title
        } as any
      });
    }).toThrow(/Event title is required/);

    expect(() => {
      compileGbpPost({
        topicType: "EVENT",
        event: {
          title: "Test Event"
        } as any
      });
    }).toThrow(/schedule with startDate and endDate is required/);
  });
});
