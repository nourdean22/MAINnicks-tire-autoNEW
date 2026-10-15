import { describe, expect, it } from "vitest";
import { webhookStatusForClaim, type InvoicePaidOutcome } from "./stripeWebhook";

// Stripe retries any non-2xx. A paid event that was not recorded must answer 500, so it is not lost.
describe("webhookStatusForClaim: which claim outcomes Stripe must retry", () => {
  const cases: Array<[InvoicePaidOutcome["kind"], 200 | 500]> = [
    ["db_unavailable", 500],
    ["amount_mismatch", 500],
    ["total_changed", 500],
    ["claimed", 200],
    ["not_claimed", 200],
    ["not_found", 200],
  ];
  it.each(cases)("%s answers %i", (kind, status) => {
    expect(webhookStatusForClaim(kind)).toBe(status);
  });
});
