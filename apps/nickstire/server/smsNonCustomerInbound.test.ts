/**
 * W2 (2026-10-30) · texts that are not a shop conversation never reach the drafter.
 *
 * Phase 1 (90 days of inbound): a third of non-STOP inbound was carrier block
 * notices, bulk marketing, auto-replies and bare links. Each one got an AI draft
 * and a staff-queue item, and five spam senders got a reply. Shapes below are
 * paraphrased from those rows. The control half is real customer wording the
 * filter must NOT swallow: a missed customer is worse than a spam text.
 */
import { describe, expect, it } from "vitest";
import { routeInboundSms, type SmsRouterContext } from "./services/smsIntentRouter";

const noCtx: SmsRouterContext = { hasActiveBooking: false, hasActiveEstimate: false, hasActiveLead: false };

describe("not a customer conversation", () => {
  it.each([
    "You have been blocked from originating messages to this number",
    "I'm Driving - Sent from My Car",
    "Hi, can I send you prices on affordable health plans from the big carriers? Reply END to opt out",
    "Open enrollment is here! Self-employed? Want a health quote? Reply YES for pricing, END to stop",
    "Automate HR with our AI payroll software. Reply YES for a demo, STOP to end",
    "Hi, I buy vacant land in Cleveland and saw you own a lot here. Interested in selling for cash?",
    "I buy junk cars with or without titles, got anything?",
    "Your order from a dealership parts department is shipping. Tracking number inside.",
    "Your file has been moved into approved status, please call us. Reply STOP to opt out",
    "https://www.facebook.com/share/r/example/",
    "Would you be open to letting local shoppers pick up packages at your store? No cost to join",
  ])("%s", (body) => {
    const d = routeInboundSms(body, noCtx);
    expect(d.primary).toBe("not_a_customer");
    expect(d.catalogEvent).toBeNull();
  });
});

describe("personal texts sent to the shop line by mistake", () => {
  it.each(["hey babe", "ok how much time babe", "hey bby"])("%s", (body) => {
    expect(routeInboundSms(body, noCtx).primary).toBe("not_a_customer");
  });
});

describe("a thank-you or FYI needs no reply and no staff-queue item", () => {
  it.each(["thanks I got it fixed", "it's ok so far!", "good so far thanks!", "everything is great, thanks for checking", "I got it taken care of, thank you so much"])(
    "%s",
    (body) => {
      const d = routeInboundSms(body, noCtx);
      expect(d.primary).toBe("no_reply_needed");
      expect(d.catalogEvent).toBeNull();
    },
  );
  it.each(["thanks, but the noise is back", "thanks, how much for 2 tires?", "thanks for checking, is my car done?"])(
    "control, a question or a problem is not a thank-you: %s",
    (body) => {
      expect(routeInboundSms(body, noCtx).primary).not.toBe("no_reply_needed");
    },
  );
});

describe("routes that sent the wrong answer in the 2026-10-30 eval", () => {
  it("an oil LEAK is not an oil-change price question", () => {
    expect(routeInboundSms("my valve cover is leaking oil", noCtx).primary).not.toBe("price_oil");
    expect(routeInboundSms("how much is an oil change", noCtx).primary).toBe("price_oil");
  });
  it("a holiday-hours question is not answered with the regular hours", () => {
    expect(routeInboundSms("are you open today for the holiday?", noCtx).primary).not.toBe("hours_location");
    expect(routeInboundSms("what are your hours", noCtx).primary).toBe("hours_location");
  });
  it("alignment has no auto-sent template until the W3 reply exists", () => {
    const d = routeInboundSms("the car is fine, I only need the alignment", noCtx);
    expect(d.primary).toBe("price_alignment");
    expect(d.catalogEvent).toBeNull();
  });
});

describe("control: customer texts stay customer texts", () => {
  it.each([
    "how much for a tire",
    "driving around feeling safe, told some friends to come see you",
    "I'll be there today",
    "do you guys buy junk cars?",
    "is there a fee? can you text me the price https://example.com/my-tire-photo.jpg",
    "please stop calling me about the estimate, I'll come in friday",
    "the car is running hot again, third time since I picked it up",
  ])("%s", (body) => {
    expect(routeInboundSms(body, noCtx).primary).not.toBe("not_a_customer");
  });
});
