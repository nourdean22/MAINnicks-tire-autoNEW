import { describe, it, expect } from "vitest";
import {
  getQuoteConfidence,
  getRiskFlags,
  getNextAction,
  getFulfillmentTimeline,
} from "../../shared/tireCommerce";

describe("Tire Commerce Command Center Helpers", () => {
  const baseOrder = {
    status: "received",
    paymentStatus: "unpaid",
    tireBrand: "FORTUNE",
    tireModel: "FSR701",
    tireSize: "205/55R16",
    quantity: 4,
    customerPhone: "2165551234",
    customerEmail: "john@example.com",
    vehicleInfo: "2020 Honda Civic",
    gatewayOrderRef: null,
    invoiceNumber: null,
    customerNotes: "Test notes",
  };

  describe("getQuoteConfidence", () => {
    it("returns low for cancelled orders", () => {
      const order = { ...baseOrder, status: "cancelled" };
      const res = getQuoteConfidence(order);
      expect(res.grade).toBe("low");
      expect(res.score).toBe(0);
    });

    it("returns high if gatewayOrderRef is present", () => {
      const order = { ...baseOrder, gatewayOrderRef: "PO-123" };
      const res = getQuoteConfidence(order);
      expect(res.grade).toBe("high");
      expect(res.score).toBe(95);
    });

    it("returns high for active fulfillment statuses", () => {
      const order = { ...baseOrder, status: "ordered" };
      const res = getQuoteConfidence(order);
      expect(res.grade).toBe("high");
      expect(res.score).toBe(95);
    });

    it("returns low for uncommon size + non-curated brand when received", () => {
      const order = { ...baseOrder, tireBrand: "UNKNOWN_BRAND", tireSize: "245/45R20", status: "received" };
      const res = getQuoteConfidence(order);
      expect(res.grade).toBe("low");
      expect(res.score).toBe(30);
    });

    it("returns low for uncommon size + curated brand when received", () => {
      const order = { ...baseOrder, tireBrand: "FORTUNE", tireSize: "245/45R20", status: "received" };
      const res = getQuoteConfidence(order);
      expect(res.grade).toBe("low");
      expect(res.score).toBe(45);
    });

    it("returns medium for popular size + curated brand when received", () => {
      const order = { ...baseOrder, tireBrand: "FORTUNE", tireSize: "205/55R16", status: "received" };
      const res = getQuoteConfidence(order);
      expect(res.grade).toBe("medium");
      expect(res.score).toBe(75);
    });
  });

  describe("getRiskFlags", () => {
    it("identifies cancelled_or_unavailable", () => {
      const order = { ...baseOrder, status: "cancelled" };
      const flags = getRiskFlags(order);
      expect(flags).toContain("cancelled_or_unavailable");
    });

    it("identifies uncommon_size", () => {
      const order = { ...baseOrder, tireSize: "245/45R20" };
      const flags = getRiskFlags(order);
      expect(flags).toContain("uncommon_size");
    });

    it("identifies missing_email", () => {
      const order = { ...baseOrder, customerEmail: null };
      const flags = getRiskFlags(order);
      expect(flags).toContain("missing_email");
    });

    it("does not identify unpaid_balance (payment bypass)", () => {
      const order = { ...baseOrder, paymentStatus: "unpaid" };
      const flags = getRiskFlags(order);
      expect(flags).not.toContain("unpaid_balance");
    });

    it("identifies unconfirmed_availability", () => {
      const order = { ...baseOrder, status: "received" };
      const flags = getRiskFlags(order);
      expect(flags).toContain("unconfirmed_availability");
    });

    it("identifies missing_gateway_reference", () => {
      const order = { ...baseOrder, status: "confirmed", gatewayOrderRef: null };
      const flags = getRiskFlags(order);
      expect(flags).toContain("missing_gateway_reference");
    });

    it("identifies manual_supplier_order_required", () => {
      const order = { ...baseOrder, tireSize: "245/45R20", status: "received" };
      const flags = getRiskFlags(order);
      expect(flags).toContain("manual_supplier_order_required");
    });

    it("identifies fitment_needs_confirmation", () => {
      const order = { ...baseOrder, vehicleInfo: "unknown" };
      const flags = getRiskFlags(order);
      expect(flags).toContain("fitment_needs_confirmation");
    });

    it("identifies high_quantity", () => {
      const order = { ...baseOrder, quantity: 6 };
      const flags = getRiskFlags(order);
      expect(flags).toContain("high_quantity");
    });

    it("identifies ready_for_install", () => {
      const order = { ...baseOrder, status: "delivered", paymentStatus: "paid" };
      const flags = getRiskFlags(order);
      expect(flags).toContain("ready_for_install");
    });

    it("identifies invoice_pending", () => {
      const order = { ...baseOrder, invoiceNumber: null };
      const flags = getRiskFlags(order);
      expect(flags).toContain("invoice_pending");
    });

    it("does not identify payment_pending (payment bypass)", () => {
      const order = { ...baseOrder, status: "scheduled", paymentStatus: "unpaid" };
      const flags = getRiskFlags(order);
      expect(flags).not.toContain("payment_pending");
    });
  });

  describe("getNextAction", () => {
    it("maps cancelled status to cancel_or_refund", () => {
      const order = { ...baseOrder, status: "cancelled" };
      const next = getNextAction(order);
      expect(next.action).toBe("cancel_or_refund");
      expect(next.priority).toBe("low");
    });

    it("maps installed unpaid status directly to invoice verification (payment bypass)", () => {
      const order = { ...baseOrder, status: "installed", paymentStatus: "unpaid" };
      const next = getNextAction(order);
      expect(next.action).toBe("verify_invoice");
      expect(next.priority).toBe("high");
    });

    it("maps received with fitment issues to confirm_fitment with high priority", () => {
      const order = { ...baseOrder, status: "received", vehicleInfo: null };
      const next = getNextAction(order);
      expect(next.action).toBe("confirm_fitment");
      expect(next.priority).toBe("high");
    });

    it("maps received to confirm_availability with high priority", () => {
      const order = { ...baseOrder, status: "received" };
      const next = getNextAction(order);
      expect(next.action).toBe("confirm_availability");
      expect(next.priority).toBe("high");
    });

    it("maps confirmed without reference to order_from_gateway", () => {
      const order = { ...baseOrder, status: "confirmed", gatewayOrderRef: null };
      const next = getNextAction(order);
      expect(next.action).toBe("order_from_gateway");
    });

    it("maps ordered status to await_delivery", () => {
      const order = { ...baseOrder, status: "ordered" };
      const next = getNextAction(order);
      expect(next.action).toBe("await_delivery");
    });

    it("maps delivered status to schedule_install", () => {
      const order = { ...baseOrder, status: "delivered" };
      const next = getNextAction(order);
      expect(next.action).toBe("schedule_install");
    });

    it("maps scheduled unpaid status directly to mark_ready_for_install (payment bypass)", () => {
      const order = { ...baseOrder, status: "scheduled", paymentStatus: "unpaid" };
      const next = getNextAction(order);
      expect(next.action).toBe("mark_ready_for_install");
    });

    it("maps scheduled paid status to mark_ready_for_install", () => {
      const order = { ...baseOrder, status: "scheduled", paymentStatus: "paid" };
      const next = getNextAction(order);
      expect(next.action).toBe("mark_ready_for_install");
    });

    it("maps installed status with invoice to close_order", () => {
      const order = { ...baseOrder, status: "installed", invoiceNumber: "INV-123", paymentStatus: "paid" };
      const next = getNextAction(order);
      expect(next.action).toBe("close_order");
    });
  });

  describe("getFulfillmentTimeline", () => {
    it("returns blocked status for all steps on cancelled orders", () => {
      const order = { ...baseOrder, status: "cancelled" };
      const timeline = getFulfillmentTimeline(order);
      timeline.forEach((step) => {
        expect(step.status).toBe("blocked");
      });
    });

    it("returns blocked status for confirmed when vehicle info is not specified", () => {
      const order = { ...baseOrder, status: "received", vehicleInfo: "not specified" };
      const timeline = getFulfillmentTimeline(order);
      const confirmedStep = timeline.find((t) => t.key === "confirmed");
      expect(confirmedStep?.status).toBe("blocked");
    });

    it("returns blocked status for ordered when confirmed but missing gateway PO", () => {
      const order = { ...baseOrder, status: "confirmed", gatewayOrderRef: null };
      const timeline = getFulfillmentTimeline(order);
      const orderedStep = timeline.find((t) => t.key === "ordered");
      expect(orderedStep?.status).toBe("blocked");
    });

    it("marks previous steps complete and current step as current", () => {
      const order = { ...baseOrder, status: "ordered", gatewayOrderRef: "PO-123" };
      const timeline = getFulfillmentTimeline(order);
      
      const receivedStep = timeline.find((t) => t.key === "received");
      const confirmedStep = timeline.find((t) => t.key === "confirmed");
      const orderedStep = timeline.find((t) => t.key === "ordered");
      const deliveredStep = timeline.find((t) => t.key === "delivered");

      expect(receivedStep?.status).toBe("complete");
      expect(confirmedStep?.status).toBe("complete");
      expect(orderedStep?.status).toBe("current");
      expect(deliveredStep?.status).toBe("pending");
    });
  });
});
