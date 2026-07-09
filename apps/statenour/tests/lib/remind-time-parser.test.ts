/**
 * AG-41 · /remind time parser — deterministic, ET-anchored, DST-aware.
 */
import { describe, it, expect } from "vitest";
import { parseRemindTime } from "@/lib/utils/remind-time-parser";

// 2026-07-09 16:00 UTC = 12:00 ET (EDT, UTC-4)
const SUMMER_NOON_ET = new Date("2026-07-09T16:00:00Z");
// 2026-01-15 17:00 UTC = 12:00 ET (EST, UTC-5)
const WINTER_NOON_ET = new Date("2026-01-15T17:00:00Z");

describe("parseRemindTime", () => {
  it("in 2h — pure offset", () => {
    const r = parseRemindTime("in 2h pick up the rotors", SUMMER_NOON_ET);
    expect(r).not.toBeNull();
    expect(r!.at.toISOString()).toBe("2026-07-09T18:00:00.000Z");
    expect(r!.text).toBe("pick up the rotors");
  });

  it("in 30 min", () => {
    const r = parseRemindTime("in 30 min call Mike", SUMMER_NOON_ET);
    expect(r!.at.toISOString()).toBe("2026-07-09T16:30:00.000Z");
  });

  it("at 3pm today-ET during EDT (UTC-4)", () => {
    const r = parseRemindTime("at 3pm call the fleet lead", SUMMER_NOON_ET);
    expect(r!.at.toISOString()).toBe("2026-07-09T19:00:00.000Z"); // 15:00 EDT
  });

  it("at 3pm today-ET during EST (UTC-5) — DST correctness", () => {
    const r = parseRemindTime("at 3pm call the fleet lead", WINTER_NOON_ET);
    expect(r!.at.toISOString()).toBe("2026-01-15T20:00:00.000Z"); // 15:00 EST
  });

  it("at 9am when it is already noon → tomorrow 9am ET", () => {
    const r = parseRemindTime("at 9am gym", SUMMER_NOON_ET);
    expect(r!.at.toISOString()).toBe("2026-07-10T13:00:00.000Z"); // next-day 09:00 EDT
  });

  it("at 15:30 (24h form)", () => {
    const r = parseRemindTime("at 15:30 check the bay", SUMMER_NOON_ET);
    expect(r!.at.toISOString()).toBe("2026-07-09T19:30:00.000Z");
  });

  it("tomorrow defaults to 9am ET", () => {
    const r = parseRemindTime("tomorrow bloodwork", SUMMER_NOON_ET);
    expect(r!.at.toISOString()).toBe("2026-07-10T13:00:00.000Z");
    expect(r!.text).toBe("bloodwork");
  });

  it("tomorrow 2pm", () => {
    const r = parseRemindTime("tomorrow 2pm fleet pricing review", SUMMER_NOON_ET);
    expect(r!.at.toISOString()).toBe("2026-07-10T18:00:00.000Z");
  });

  it("rejects: no expression, no text, junk hours", () => {
    expect(parseRemindTime("pick up rotors", SUMMER_NOON_ET)).toBeNull();
    expect(parseRemindTime("in 2h", SUMMER_NOON_ET)).toBeNull();
    expect(parseRemindTime("at 25pm x", SUMMER_NOON_ET)).toBeNull();
    expect(parseRemindTime("in 0 min x", SUMMER_NOON_ET)).toBeNull();
  });
});
