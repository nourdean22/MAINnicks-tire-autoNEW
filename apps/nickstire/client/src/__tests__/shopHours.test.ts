/**
 * shopHours — Eastern time, derived from canon, with the labels the strip shows.
 *
 * Canon (shared/business.ts): Mon–Sat 08:00–18:00, Sun 09:00–16:00. Every
 * instant below is written in UTC and annotated with its Cleveland time so
 * the assertion is about the SHOP's clock, not the machine's.
 * September 2026 is EDT (UTC−4); the November case is EST (UTC−5).
 */
import { describe, expect, it } from "vitest";
import { getOpenStatus, resolveDueAt, type DuePickId } from "@/lib/shopHours";

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

/**
 * resolveDueAt — the Promises quick-picks.
 *
 * Before 2026-09-16 these were durations: "End of day" = now+6h, "Tomorrow" =
 * now+24h. Each `it` below names the instant the OLD arithmetic would have
 * produced, so the test doubles as the regression record.
 *
 * 2026 DST: forward Sun Mar 8, back Sun Nov 1.
 */
describe("resolveDueAt — business-calendar due times", () => {
  const due = (pick: DuePickId, iso: string) => resolveDueAt(pick, new Date(iso));

  it("in_2h stays a real duration", () => {
    const r = due("in_2h", "2026-09-14T16:00:00Z"); // Mon 12:00 ET
    expect(r.dueAt.toISOString()).toBe("2026-09-14T18:00:00.000Z");
    expect(r.detail).toBe("2 hours from now");
  });

  it("end_of_day in the morning is TODAY at close, not six hours later", () => {
    // Mon 09:10 ET. Old code: 15:10 ET — nearly 3h BEFORE the shop shuts.
    const r = due("end_of_day", "2026-09-14T13:10:00Z");
    expect(r.dueAt.toISOString()).toBe("2026-09-14T22:00:00.000Z"); // Mon 18:00 ET
    expect(r.detail).toBe("today at close · 6 PM");
  });

  it("end_of_day late in the afternoon is still today at close, not after hours", () => {
    // Mon 16:30 ET. Old code: 22:30 ET — 4.5h AFTER the shop shut.
    expect(due("end_of_day", "2026-09-14T20:30:00Z").dueAt.toISOString()).toBe("2026-09-14T22:00:00.000Z");
  });

  it("end_of_day past close rolls to the next day that shuts", () => {
    // Mon 18:30 ET, already closed -> Tue 18:00 ET.
    const r = due("end_of_day", "2026-09-14T22:30:00Z");
    expect(r.dueAt.toISOString()).toBe("2026-09-15T22:00:00.000Z");
    expect(r.detail).toBe("Tue at close · 6 PM");
  });

  it("end_of_day past close on Saturday uses SUNDAY's earlier 4 PM close", () => {
    // Sat 19:00 ET -> Sun 16:00 ET. A flat +6h/+24h could never find this.
    const r = due("end_of_day", "2026-09-12T23:00:00Z");
    expect(r.dueAt.toISOString()).toBe("2026-09-13T20:00:00.000Z");
    expect(r.detail).toBe("Sun at close · 4 PM");
  });

  it("next_open is tomorrow's OPENING time, not +24h", () => {
    // Mon 17:00 ET. Old code: Tue 17:00 ET — an hour before close, not morning.
    const r = due("next_open", "2026-09-14T21:00:00Z");
    expect(r.dueAt.toISOString()).toBe("2026-09-15T12:00:00.000Z"); // Tue 08:00 ET
    expect(r.detail).toBe("Tue at open · 8 AM");
  });

  it("next_open after Saturday is Sunday's 9 AM, not 8 AM", () => {
    const r = due("next_open", "2026-09-12T21:00:00Z"); // Sat 17:00 ET
    expect(r.dueAt.toISOString()).toBe("2026-09-13T13:00:00.000Z"); // Sun 09:00 EDT
    expect(r.detail).toBe("Sun at open · 9 AM");
  });

  it("canary · DST fall-back: the promise lands at 9 AM EST, not 9 AM EDT", () => {
    // Sat 2026-10-31 19:00 EDT. Next open is Sun Nov 1 09:00 — and Nov 1 is the
    // fall-back day, so that wall clock is EST (UTC-5) = 14:00Z. Carrying the
    // pre-transition -4 offset would yield 13:00Z, i.e. 8 AM: an hour early.
    expect(due("next_open", "2026-10-31T23:00:00Z").dueAt.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("canary · DST spring-forward: the promise lands at 9 AM EDT, not 9 AM EST", () => {
    // 2026-03-08T00:00Z is Sat Mar 7 19:00 EST (UTC-5) — note the UTC date is
    // already the 8th while Cleveland is still on the 7th. Next open is Sun
    // Mar 8 09:00, after the 2 AM jump, so EDT (UTC-4) = 13:00Z. Carrying the
    // pre-transition -5 offset would give 14:00Z: an hour late.
    expect(due("next_open", "2026-03-08T00:00:00Z").dueAt.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("canary · the pick is read on the SHOP's clock, not the device's", () => {
    // 2026-09-14T02:00:00Z is Sunday 22:00 in Cleveland, not Monday.
    // A UTC reading would call it Monday and pick Monday's 6 PM close.
    const r = due("end_of_day", "2026-09-14T02:00:00Z");
    expect(r.detail).toBe("Mon at close · 6 PM"); // Sunday is already shut -> next shutting day
    expect(r.dueAt.toISOString()).toBe("2026-09-14T22:00:00.000Z");
  });

  it("every pick resolves to a real future instant with no instant supplied", () => {
    for (const pick of ["in_2h", "end_of_day", "next_open"] as DuePickId[]) {
      const r = resolveDueAt(pick);
      expect(Number.isNaN(r.dueAt.getTime())).toBe(false);
      expect(r.dueAt.getTime()).toBeGreaterThan(Date.now());
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });
});
