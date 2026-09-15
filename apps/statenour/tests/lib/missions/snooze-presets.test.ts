/**
 * Snooze presets · 2026-09-15. Lifted from mission-task-row.tsx; the task
 * inspector's page actions and the row must snooze to the same instants.
 * Local-time helpers, so the assertions read back with local getters.
 */
import { describe, expect, it } from "vitest";
import { nextMonday6am, tomorrow6am } from "@/lib/missions/snooze-presets";

describe("snooze presets", () => {
  it("tomorrow6am is the next calendar day at 06:00 local", () => {
    const now = new Date(2026, 8, 15, 22, 45); // Tue Sep 15 2026, late evening
    const d = new Date(tomorrow6am(now));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 8, 16, 6, 0]);
  });

  it("nextMonday6am skips to the FOLLOWING Monday when today is Monday", () => {
    const monday = new Date(2026, 8, 14, 9, 0); // Mon Sep 14 2026
    const d = new Date(nextMonday6am(monday));
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(21);
    expect(d.getHours()).toBe(6);
  });

  it("nextMonday6am from a Sunday is tomorrow; from a Tuesday is six days out", () => {
    expect(new Date(nextMonday6am(new Date(2026, 8, 13, 12))).getDate()).toBe(14); // Sun → Mon 14
    expect(new Date(nextMonday6am(new Date(2026, 8, 15, 12))).getDate()).toBe(21); // Tue → Mon 21
  });
});
