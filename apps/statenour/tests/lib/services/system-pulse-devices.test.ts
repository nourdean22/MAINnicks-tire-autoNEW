/**
 * tests/lib/services/system-pulse-devices.test.ts · 2026-09-07
 *
 * "20 devices offline" on the Home headline were cameras last seen
 * 2026-04-14 — an April incident counted as a September one, every day, until
 * the headline meant nothing (program D11). Health now separates:
 *   · devicesOffline      — expected devices that went dark RECENTLY (the
 *                           incident number; interrupts);
 *   · devicesOfflineLong  — expected devices dark for weeks: still an
 *                           unresolved fault, but a "classify me" item, not a
 *                           new alarm;
 *   · devicesRetired      — an OWNER decision (status RETIRED) — history, not
 *                           health; excluded from every offline count and total.
 * Nothing is auto-retired by age: retirement is a lifecycle decision.
 */
import { describe, it, expect } from "vitest";
import { classifyDevices, DEVICE_RECENT_WINDOW_DAYS } from "@/lib/services/system-pulse";

const NOW = new Date("2026-09-07T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("classifyDevices", () => {
  it("splits recent incidents from weeks-old unclassified ones, and excludes retired", () => {
    const rows = [
      { status: "ONLINE", lastSeenAt: daysAgo(0), createdAt: daysAgo(100) },
      { status: "OFFLINE", lastSeenAt: daysAgo(1), createdAt: daysAgo(100) }, // recent incident
      { status: "OFFLINE", lastSeenAt: daysAgo(146), createdAt: daysAgo(200) }, // the April camera
      { status: "ERROR", lastSeenAt: daysAgo(40), createdAt: daysAgo(200) }, // long
      { status: "UNKNOWN", lastSeenAt: null, createdAt: daysAgo(2) }, // never seen, new → recent
      { status: "UNKNOWN", lastSeenAt: null, createdAt: daysAgo(60) }, // never seen, old → long
      { status: "RETIRED", lastSeenAt: daysAgo(146), createdAt: daysAgo(200) }, // owner decision
    ];
    const h = classifyDevices(rows, NOW);
    expect(h.devicesOffline).toBe(2);
    expect(h.devicesOfflineLong).toBe(3);
    expect(h.devicesRetired).toBe(1);
    expect(h.devicesTotal).toBe(6); // retired excluded
  });

  it("the recent window is a bounded number of days, not zero and not forever", () => {
    expect(DEVICE_RECENT_WINDOW_DAYS).toBeGreaterThan(0);
    expect(DEVICE_RECENT_WINDOW_DAYS).toBeLessThanOrEqual(30);
  });

  it("boundary: exactly at the window edge counts as long, one minute inside as recent", () => {
    const edge = new Date(NOW.getTime() - DEVICE_RECENT_WINDOW_DAYS * 86_400_000);
    const inside = new Date(edge.getTime() + 60_000);
    expect(classifyDevices([{ status: "OFFLINE", lastSeenAt: edge, createdAt: daysAgo(100) }], NOW).devicesOfflineLong).toBe(1);
    expect(classifyDevices([{ status: "OFFLINE", lastSeenAt: inside, createdAt: daysAgo(100) }], NOW).devicesOffline).toBe(1);
  });

  it("canary: an all-retired fleet reports zero offline and zero total, never a phantom incident", () => {
    const h = classifyDevices([{ status: "RETIRED", lastSeenAt: daysAgo(1), createdAt: daysAgo(1) }], NOW);
    expect(h).toMatchObject({ devicesOffline: 0, devicesOfflineLong: 0, devicesTotal: 0, devicesRetired: 1 });
  });
});
