/**
 * VAPI write-contract mappers (2026-07-11).
 *
 * Locks the statenour→nickstire voice contract: nickstire-write.ts
 * payload shapes → real CRM rows. These endpoints were MISSING for the
 * contract's whole life — every voice drop-off/callback silently
 * degraded to statenour brainMemory and never reached the shop.
 */
import { describe, it, expect } from "vitest";
import {
  VapiDropoffInput,
  VapiCallbackInput,
  mapDropoffToBooking,
  mapCallbackToRow,
  mapCustomerToLookup,
} from "./bridge-routes";

const DROPOFF = {
  source: "vapi-receptionist",
  vapiCallId: "call_123",
  capturedAt: "2026-07-11T14:00:00Z",
  name: "Jane Doe",
  phone: "(216) 555-0142",
  vehicle: { year: 2019, make: "Honda", model: "Civic" },
  concern: "grinding noise when braking",
  preferredTime: "tomorrow morning",
  driveable: true,
  returningCustomer: "yes",
};

describe("mapDropoffToBooking", () => {
  it("maps the full statenour payload to a bookings row", () => {
    const p = VapiDropoffInput.parse(DROPOFF);
    const out = mapDropoffToBooking(p);
    expect("values" in out).toBe(true);
    if (!("values" in out)) return;
    expect(out.values.name).toBe("Jane Doe");
    expect(out.values.phone).toBe("+12165550142"); // normalized, matches SMS-bot convention
    expect(out.values.service).toBe("drop-off");
    expect(out.values.vehicle).toBe("2019 Honda Civic");
    expect(out.values.preferredTime).toBe("morning"); // heuristic from "tomorrow morning"
    expect(out.values.message).toContain("grinding noise");
    expect(out.values.message).toContain("call_123");
    expect(out.values.status).toBe("new");
    expect(out.values.stage).toBe("received");
  });

  it("rejects a payload with no dialable phone (no ghost bookings)", () => {
    const p = VapiDropoffInput.parse({ ...DROPOFF, phone: null });
    const out = mapDropoffToBooking(p);
    expect("error" in out).toBe(true);
  });

  it("maps afternoon-ish times and defaults unknown to no-preference", () => {
    const pm = mapDropoffToBooking(VapiDropoffInput.parse({ ...DROPOFF, preferredTime: "late afternoon" }));
    const none = mapDropoffToBooking(VapiDropoffInput.parse({ ...DROPOFF, preferredTime: "whenever works" }));
    if ("values" in pm) expect(pm.values.preferredTime).toBe("afternoon");
    if ("values" in none) expect(none.values.preferredTime).toBe("no-preference");
  });

  it("falls back to a usable name when the caller gave none", () => {
    const out = mapDropoffToBooking(VapiDropoffInput.parse({ ...DROPOFF, name: null }));
    if ("values" in out) expect(out.values.name).toBe("Voice Drop-Off Customer");
  });
});

describe("mapCallbackToRow", () => {
  it("maps to a callback_requests row with assembled context", () => {
    const p = VapiCallbackInput.parse({
      source: "vapi-receptionist",
      capturedAt: "2026-07-11T14:05:00Z",
      name: "Bob",
      phone: "216-555-0100",
      reason: "wants a quote on 4 tires",
      urgency: "high",
      preferredTime: "after 3pm",
      language: "es",
    });
    const out = mapCallbackToRow(p);
    expect("values" in out).toBe(true);
    if (!("values" in out)) return;
    expect(out.values.phone).toBe("+12165550100");
    expect(out.values.sourcePage).toBe("vapi:vapi-receptionist");
    expect(out.values.context).toContain("wants a quote");
    expect(out.values.context).toContain("Urgency: high");
    expect(out.values.context).toContain("Language: es");
    expect(out.values.status).toBe("new");
  });

  it("rejects when phone is missing", () => {
    const p = VapiCallbackInput.parse({ source: "s", capturedAt: "t", phone: "" });
    expect("error" in mapCallbackToRow(p)).toBe(true);
  });
});

describe("mapCustomerToLookup", () => {
  it("returns found:false for no row", () => {
    expect(mapCustomerToLookup(undefined)).toEqual({ found: false });
  });

  it("maps a customer row to the statenour CustomerLookupResult shape", () => {
    const out = mapCustomerToLookup({
      firstName: "Jane", lastName: "Doe", phone: "2165550142",
      totalVisits: 7, lastVisitDate: new Date("2026-07-01T00:00:00Z"),
    });
    expect(out).toMatchObject({
      found: true, name: "Jane Doe", phone: "2165550142",
      visitCount: 7, lastVisitAt: "2026-07-01T00:00:00.000Z", notes: null,
    });
  });
});
