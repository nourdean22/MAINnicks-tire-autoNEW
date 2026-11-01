/**
 * Calendar r2 W3 (manager ruling 15:42Z): for the first week, every calendar write Nick makes waits
 * for Nour's approval in System > Actions and runs once when he approves (the existing two-key
 * path). The hold ends on its date by itself; reads are never held.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  approvalRequest: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "req_cal", ...data })), findMany: vi.fn(async () => []) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { CALENDAR_WRITE_CONFIRM_UNTIL, isIrreversibleCustomerSend, twoKeyGate } from "@/lib/tools/two-key";

const WRITES = ["proposeCalendarEvent", "moveCalendarEvent", "deleteCalendarEvent"];
const until = new Date(CALENDAR_WRITE_CONFIRM_UNTIL).getTime();

afterEach(() => vi.useRealTimers());

describe("calendar writes · first-week confirm step", () => {
  it.each(WRITES)("%s is held for his approval before the date", (tool) => {
    vi.useFakeTimers().setSystemTime(until - 60_000);
    expect(isIrreversibleCustomerSend(tool, { eventId: "e1" })).toBe(true);
  });

  it.each(WRITES)("%s runs on its own once the date has passed (the hold expires by itself)", (tool) => {
    vi.useFakeTimers().setSystemTime(until + 60_000);
    expect(isIrreversibleCustomerSend(tool, { eventId: "e1" })).toBe(false);
  });

  it("CONTROL: reading the calendar is never held", () => {
    vi.useFakeTimers().setSystemTime(until - 60_000);
    expect(isIrreversibleCustomerSend("getTodaySchedule", { daysAhead: 1 })).toBe(false);
  });

  it("a held write is refused into the approvals queue with words that say it did not happen", async () => {
    vi.useFakeTimers().setSystemTime(until - 60_000);
    const r = await twoKeyGate("moveCalendarEvent", { eventId: "e1", startISO: "2026-11-03T14:00", endISO: "2026-11-03T15:00" });
    expect(r).toMatchObject({ error: "approval_required", requestId: "req_cal" });
    expect(r?.reflection.guidance).toMatch(/NOT/);
    expect(r?.reflection.guidance).toMatch(/System > Actions/);
  });
});
