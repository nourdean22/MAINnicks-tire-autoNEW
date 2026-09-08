/**
 * shopHours — Eastern time, derived from canon, with the labels the strip shows.
 *
 * Canon (shared/business.ts): Mon–Sat 08:00–18:00, Sun 09:00–16:00. Every
 * instant below is written in UTC and annotated with its Cleveland time so
 * the assertion is about the SHOP's clock, not the machine's.
 * September 2026 is EDT (UTC−4); the November case is EST (UTC−5).
 */
import { describe, expect, it } from "vitest";
import { getOpenStatus } from "@/lib/shopHours";

const at = (iso: string) => getOpenStatus(new Date(iso));

describe("getOpenStatus — Cleveland clock", () => {
  it("Monday noon ET → open, closes 6 PM", () => {
    expect(at("2026-09-14T16:00:00Z")).toEqual({ isOpen: true, label: "Open Now", until: "Closes 6 PM" });
  });

  it("Monday 7:30 AM ET → closed, opens 8 AM today", () => {
    expect(at("2026-09-14T11:30:00Z")).toEqual({ isOpen: false, label: "Opens at 8 AM", until: "Opens 8 AM" });
  });

  it("Monday 6:30 PM ET → closed, opens tomorrow 8 AM", () => {
    expect(at("2026-09-14T22:30:00Z")).toEqual({ isOpen: false, label: "Opens at 8 AM", until: "Opens tomorrow 8 AM" });
  });

  it("Saturday 6:30 PM ET → closed, opens tomorrow (Sunday) 9 AM", () => {
    expect(at("2026-09-12T22:30:00Z")).toEqual({ isOpen: false, label: "Opens at 9 AM", until: "Opens tomorrow 9 AM" });
  });

  it("Sunday 10 AM ET → open, closes 4 PM", () => {
    expect(at("2026-09-13T14:00:00Z")).toEqual({ isOpen: true, label: "Open Now", until: "Closes 4 PM" });
  });

  it("Sunday 4:30 PM ET → closed, opens tomorrow (Monday) 8 AM", () => {
    expect(at("2026-09-13T20:30:00Z")).toEqual({ isOpen: false, label: "Opens at 8 AM", until: "Opens tomorrow 8 AM" });
  });

  it("boundaries are half-open: 8:00 is open, 6:00 PM is closed", () => {
    expect(at("2026-09-14T12:00:00Z").isOpen).toBe(true); // 08:00 ET
    expect(at("2026-09-14T22:00:00Z").isOpen).toBe(false); // 18:00 ET
  });

  it("canary: the clock is Cleveland's, not UTC — 9:00 UTC is 5 AM in Cleveland, closed", () => {
    // A UTC-based reading sees 09:00 (inside 08–18) and says open.
    expect(at("2026-09-14T09:00:00Z")).toEqual({ isOpen: false, label: "Opens at 8 AM", until: "Opens 8 AM" });
  });

  it("canary: after the November fall-back the offset is −5 and the answer still follows the shop", () => {
    expect(at("2026-11-02T10:30:00Z").isOpen).toBe(false); // Mon 05:30 EST
    expect(at("2026-11-02T13:30:00Z")).toEqual({ isOpen: true, label: "Open Now", until: "Closes 6 PM" }); // Mon 08:30 EST
  });

  it("uses the device clock only when no instant is given", () => {
    const s = getOpenStatus();
    expect(typeof s.isOpen).toBe("boolean");
    expect(s.until).toMatch(/^(Closes|Opens)/);
  });
});
