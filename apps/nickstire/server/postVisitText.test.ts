/**
 * Post-visit text (Draft D, approved by Nour 2026-10-24).
 *
 * The first message after a visit leads with "text us here" and asks for the review second.
 * These tests assert the CONSUMER: the string each live send path hands to sendSms, with the
 * expected text written out in full here, never built from the builder under test.
 *
 * "text us here" is only true if the sender is the shop line (replies land in the admin
 * Messages inbox), so every site is also pinned to `via: "shop"`.
 *
 * vi.doMock per test + vi.doUnmock in afterEach: doMocks are NOT file-scoped under singleFork
 * (apps/nickstire/AGENTS.md section 3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@shared/business";

// Real schema + drizzle-orm: postInvoiceFollowUp.ts imports `customers` at module load.
vi.unmock("../drizzle/schema");
vi.unmock("drizzle-orm");

const sendSms = vi.fn(async (..._args: unknown[]) => ({ success: true, sid: "SM_fixture" }) as Record<string, unknown>);
const DOMOCKED = ["./db", "./sms", "./services/featureFlags"];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T16:00:00.000Z")); // Tue noon ET: inside the 9-19 send window
  sendSms.mockClear();
  // The per-send pacing sleeps resolve immediately.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void) => {
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn(async () => true) }));
});

afterEach(() => {
  for (const m of DOMOCKED) vi.doUnmock(m);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe("builder", () => {
  it("is Draft D, byte for byte", async () => {
    const { postVisitText } = await import("./lib/postVisitText");
    expect(postVisitText("Dana", "https://example.test/r/abc123")).toBe(
      "Hi Dana, it's Nick's Tire & Auto on Euclid. Thanks for coming in. If anything about the car feels off, text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went: https://example.test/r/abc123",
    );
  });

  it("stays GSM-7 with the STOP footer sendSms appends once: 2 segments on the short URL, 3 on the 87-char tracking URL", async () => {
    const { postVisitText } = await import("./lib/postVisitText");
    const { withOptOut } = await vi.importActual<typeof import("./sms")>("./sms");
    const trackingUrl = `https://nickstire.org/api/review-click/${"a".repeat(48)}`; // 48 hex chars = randomBytes(24)
    expect(trackingUrl).toHaveLength(87);
    const shortSent = withOptOut(postVisitText("Dana", "nickstire.org/review"));
    const trackedSent = withOptOut(postVisitText("Dana", trackingUrl));
    for (const sent of [shortSent, trackedSent]) {
      // Smart quotes and em dashes (copy-paste) are outside GSM-7 and flip the whole text to UCS-2.
      expect(sent).toMatch(/^[A-Za-z0-9 .,'&:/\n-]+$/);
      expect(sent.endsWith("\n\nReply STOP to opt out.")).toBe(true);
      expect(sent.match(/reply stop/gi)).toHaveLength(1); // the footer is appended once, never duplicated
    }
    expect(shortSent.length).toBeLessThanOrEqual(306); // 2 concatenated GSM-7 segments of 153
    expect(trackedSent.length).toBeLessThanOrEqual(459); // 3 segments
  });
});

describe("review-requests cron (invoice-keyed and booking-keyed rows)", () => {
  async function run(row: Record<string, unknown>, settings: Record<string, unknown> = { messageTemplate: null }) {
    vi.doMock("./db", () => ({
      getReviewSettings: async () => ({ enabled: 1, maxPerDay: 50, ...settings }),
      getReviewRequestsSentToday: async () => 0,
      getPendingReviewRequests: async () => [{ id: 21, phone: "2165550142", service: null, trackingToken: "tok123", ...row }],
      claimReviewRequest: async () => true,
      markReviewRequestSent: vi.fn(),
      markReviewRequestHeldOut: vi.fn(),
      markReviewRequestFailed: vi.fn(),
    }));
    vi.doMock("./sms", () => ({ sendSms, withOptOut: (s: string) => s, isShopGatewayReachable: async () => true }));
    const { processReviewRequestQueue } = await import("./routers/reviewRequests");
    return processReviewRequestQueue();
  }
  const trackingUrl = `${SITE_URL}/api/review-click/tok123`;

  it("hands sendSms Draft D for an invoice-keyed row, from the shop line", async () => {
    const res = await run({ customerName: "David Aiken" });
    expect(res).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith(
      "+12165550142",
      `Hi David, it's Nick's Tire & Auto on Euclid. Thanks for coming in. If anything about the car feels off, text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went: ${trackingUrl}`,
      expect.objectContaining({ via: "shop", variantKey: "review_request" }),
    );
  });

  it("greets 'there' when the row carries no usable first name (invoiceReviewRequests normalises to it)", async () => {
    await run({ customerName: "there" });
    expect(sendSms.mock.calls[0][1]).toBe(
      `Hi there, it's Nick's Tire & Auto on Euclid. Thanks for coming in. If anything about the car feels off, text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went: ${trackingUrl}`,
    );
  });

  it("sends the same text for a booking-keyed row; the booked service no longer appears in it", async () => {
    await run({ customerName: "Pat Example", service: "Brake Service" });
    expect(sendSms.mock.calls[0][1]).toBe(
      `Hi Pat, it's Nick's Tire & Auto on Euclid. Thanks for coming in. If anything about the car feels off, text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went: ${trackingUrl}`,
    );
  });

  it("control: an admin-set custom template still wins and is untouched", async () => {
    await run(
      { customerName: "David Aiken", service: "Brakes" },
      { messageTemplate: "Custom for {firstName} about {service}: {reviewUrl}" },
    );
    expect(sendSms.mock.calls[0][1]).toBe(`Custom for David about Brakes: ${trackingUrl}`);
  });
});

describe("post-invoice-followup cron (customer-keyed)", () => {
  async function run(customer: Record<string, unknown>) {
    vi.doMock("./db", () => ({
      getReviewSettings: async () => ({ enabled: 1, cooldownDays: 30 }),
      isPhoneOnReviewCooldown: async () => false,
      getDb: async () => ({
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [customer] }) }) }),
        update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
      }),
    }));
    vi.doMock("./sms", () => ({ sendSms }));
    const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
    return processPostInvoiceFollowUps();
  }
  const expected = (first: string) =>
    `Hi ${first}, it's Nick's Tire & Auto on Euclid. Thanks for coming in. If anything about the car feels off, text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went: nickstire.org/review`;

  it("hands sendSms Draft D for a recent-segment customer, from the shop line", async () => {
    const res = await run({ id: 9, firstName: "Sam", phone: "2165550123", segment: "recent" });
    expect(res).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith("2165550123", expected("Sam"), { via: "shop" });
  });

  it("hands sendSms the same Draft D for a lapsed-segment customer (the visit was 7 days ago either way)", async () => {
    await run({ id: 10, firstName: "Riley", phone: "2165550124", segment: "lapsed" });
    expect(sendSms.mock.calls[0][1]).toBe(expected("Riley"));
  });
});
