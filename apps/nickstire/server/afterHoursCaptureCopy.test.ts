/**
 * The after-hours text (after_hours_capture) says only what is true.
 *
 * It fires when a web form (quote, booking or callback request) is submitted
 * while the shop is closed (services/afterHours.ts handleAfterHoursCapture).
 * Until 2026-09-23 two variants promised "we'll reach back out" — nothing
 * tracks that promise — and one opened "Thanks for texting" (the customer used
 * a form) and hard-coded "tomorrow morning", which is false on Friday and
 * Saturday nights. The orchestrator already fills {nextOpen} with the real
 * opening time from the shop's hours (research doc Part C #39).
 */
import { describe, expect, it } from "vitest";
import { TEMPLATE_VARIANTS, getTemplateVariant } from "./services/smsMessageCatalog";

const variants = TEMPLATE_VARIANTS.after_hours_capture;

describe("after-hours text · no untracked promise, the real opening time", () => {
  it("has variants to check (positive control against an empty list)", () => {
    expect(variants.length).toBeGreaterThanOrEqual(3);
  });

  it.each(variants.map((v, i) => [i + 1, v] as const))("v%i carries the real opening time", (_i, v) => {
    expect(v).toContain("{nextOpen}");
  });

  it.each(variants.map((v, i) => [i + 1, v] as const))("v%i promises no callback, no fixed day, and does not say 'texting'", (_i, v) => {
    expect(v).not.toMatch(/reach back out|call you|text you back|get back to you|tomorrow morning|texting/i);
  });

  it("the placeholder is filled when the text is built", () => {
    for (let i = 0; i < variants.length; i++) {
      const { body } = getTemplateVariant("after_hours_capture", { nextOpen: "9:00 AM Sunday" }, i);
      expect(body).toContain("9:00 AM Sunday");
      expect(body).not.toContain("{");
    }
  });
});
