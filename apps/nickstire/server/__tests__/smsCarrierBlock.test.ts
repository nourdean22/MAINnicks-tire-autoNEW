/**
 * Carrier-block suppression — fourth opt-out-index source (2026-08-05).
 *
 * Prod evidence: 17 inbound "You have been blocked from originating messages
 * to 1XXXXXXXXXX" carrier notices across 6 numbers in 90 days, with nothing
 * suppressing further automated sends to those numbers.
 *
 * Contract under test (pure, DB-free):
 * - the suppressed number comes from the NOTICE BODY, not the sender
 * - an inbound from that number STRICTLY LATER than the newest notice lifts
 *   the suppression (a block is not a STOP — it can be undone by the customer)
 * - malformed rows are skipped, never thrown (a throw would fail the whole
 *   index build and fail-closed would refuse every send)
 */
import { describe, it, expect } from "vitest";
import { carrierBlockedPhones } from "../sms";

const T0 = new Date("2026-07-19T17:38:16Z");
const T1 = new Date("2026-07-20T22:05:46Z");
const LATER = new Date("2026-07-25T12:00:00Z");
const notice = (num: string, at: Date) => ({
  body: `You have been blocked from originating messages to ${num}`,
  createdAt: at,
});

describe("carrierBlockedPhones", () => {
  it("extracts the target number from the notice body (prod shape, 11-digit)", () => {
    const out = carrierBlockedPhones([notice("12163994637", T0)], new Map());
    expect(out.has("2163994637")).toBe(true);
    expect(out.size).toBe(1);
  });

  it("an inbound STRICTLY LATER than the newest notice lifts the suppression", () => {
    const out = carrierBlockedPhones(
      [notice("12163994637", T0)],
      new Map([["2163994637", LATER]]),
    );
    expect(out.has("2163994637")).toBe(false);
  });

  it("an inbound BEFORE the newest notice does not lift it (uses newest of repeated notices)", () => {
    const out = carrierBlockedPhones(
      [notice("12163994637", T0), notice("12163994637", T1)],
      new Map([["2163994637", new Date("2026-07-20T00:00:00Z")]]), // between T0 and T1
    );
    expect(out.has("2163994637")).toBe(true);
  });

  it("an inbound at exactly the notice time does NOT lift it (notice wins ties)", () => {
    const out = carrierBlockedPhones([notice("12163994637", T0)], new Map([["2163994637", T0]]));
    expect(out.has("2163994637")).toBe(true);
  });

  it("a text that merely QUOTES the phrase mid-sentence suppresses nobody", () => {
    const out = carrierBlockedPhones(
      [{ body: "lol I got 'You have been blocked from originating messages to 12165551234' when I texted my ex", createdAt: T0 }],
      new Map(),
    );
    expect(out.size).toBe(0);
  });

  it("malformed rows (missing/non-string body, bad dates, short numbers) are skipped, not thrown", () => {
    const out = carrierBlockedPhones(
      [
        { body: undefined as unknown as string, createdAt: T0 },
        { body: 42 as unknown as string, createdAt: T0 },
        { body: "You have been blocked from originating messages to 12345", createdAt: T0 },
        { body: "You have been blocked from originating messages to 12163994637", createdAt: "not-a-date" },
        notice("12168351535", T1),
      ],
      new Map(),
    );
    expect(out.size).toBe(1);
    expect(out.has("2168351535")).toBe(true);
  });

  it("multiple distinct numbers all suppress independently", () => {
    const out = carrierBlockedPhones(
      [notice("12163994637", T0), notice("12168351535", T1)],
      new Map([["2163994637", LATER]]),
    );
    expect(out.has("2163994637")).toBe(false); // lifted by later inbound
    expect(out.has("2168351535")).toBe(true);
  });
});
