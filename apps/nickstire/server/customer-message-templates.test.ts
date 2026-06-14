/**
 * Tests for the PREVIEW-ONLY customer message templates.
 * The most important assertions here are the safety ones: the send path
 * always throws, and no template makes a reservation/guarantee claim.
 */
import { describe, it, expect } from "vitest";
import {
  TEMPLATE_BUILDERS,
  sendCustomerMessage,
  type OrderMessageInput,
} from "./services/customerMessageTemplates";

const ORDER: OrderMessageInput = {
  customerName: "Jane Doe",
  orderNumber: "TO-20260610-123",
  quantity: 4,
  tireBrand: "NEXEN",
  tireModel: "N'Priz AH5",
  tireSize: "215/60R16",
  totalAmount: 544.0,
};

describe("customer message templates (preview-only)", () => {
  it("renders all five templates with order facts", () => {
    for (const [key, build] of Object.entries(TEMPLATE_BUILDERS)) {
      const msg = build(ORDER);
      expect(msg.sms.length, `${key} sms`).toBeGreaterThan(20);
      expect(msg.email.subject).toContain("TO-20260610-123");
      expect(msg.email.body).toContain("Jane Doe");
      expect(msg.sms).toContain("(216) 862-0005");
    }
  });

  it("keeps SMS bodies in a sane length band", () => {
    for (const [key, build] of Object.entries(TEMPLATE_BUILDERS)) {
      expect(build(ORDER).sms.length, `${key} sms length`).toBeLessThanOrEqual(320);
    }
  });

  it("never claims reservation or guaranteed stock (claim safety)", () => {
    for (const [key, build] of Object.entries(TEMPLATE_BUILDERS)) {
      const msg = build(ORDER);
      const all = `${msg.sms} ${msg.email.subject} ${msg.email.body}`.toLowerCase();
      expect(all, `${key} must not say reserved`).not.toMatch(/\breserved\b/);
      expect(all, `${key} must not say guarantee(d)`).not.toMatch(/\bguaranteed?\b(?! until staff)/);
    }
  });

  it("payment template states payment does not reserve supplier stock", () => {
    const msg = TEMPLATE_BUILDERS.paymentReceived(ORDER);
    expect(msg.email.body).toContain("does not reserve supplier stock");
  });

  it("THE SEND PATH ALWAYS THROWS — sending is disabled by design", () => {
    expect(() => sendCustomerMessage()).toThrowError(/disabled by design/);
  });

  it("manual-lookup template promises no charge and no order yet", () => {
    const msg = TEMPLATE_BUILDERS.manualLookupReceived(ORDER);
    expect(msg.email.body).toContain("nothing is ordered or charged yet");
  });
});
