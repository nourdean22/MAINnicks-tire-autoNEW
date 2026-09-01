/**
 * Due-reminder decision core — both directions pinned (canary rule):
 * every plan asserts the action AND that removing the input removes it.
 */
import { describe, expect, it } from "vitest";
import { dueReminderPlan } from "@/lib/services/task-due-reminders";

const NOW = new Date("2026-09-01T15:00:00Z");
const DAY = 86_400_000;
const future = new Date(NOW.getTime() + 2 * DAY);
const past = new Date(NOW.getTime() - 2 * DAY);

describe("dueReminderPlan", () => {
  it("no change → none (identical instants, both null, string-vs-Date equal)", () => {
    expect(dueReminderPlan(null, null, NOW).action).toBe("none");
    expect(dueReminderPlan(future, new Date(future), NOW).action).toBe("none");
    expect(dueReminderPlan(future.toISOString(), future, NOW).action).toBe("none");
  });

  it("new future due → reschedule with the exact instant", () => {
    const plan = dueReminderPlan(null, future, NOW);
    expect(plan).toEqual({ action: "reschedule", dueAt: future.toISOString() });
  });

  it("due moved → reschedule to the NEW instant", () => {
    const later = new Date(future.getTime() + DAY);
    const plan = dueReminderPlan(future, later, NOW);
    expect(plan).toEqual({ action: "reschedule", dueAt: later.toISOString() });
  });

  it("due cleared → cancel, arm nothing", () => {
    expect(dueReminderPlan(future, null, NOW)).toEqual({ action: "cancel" });
  });

  it("due moved into the past → cancel (a sleeper for a past instant would fire instantly)", () => {
    expect(dueReminderPlan(future, past, NOW)).toEqual({ action: "cancel" });
  });

  it("born already-overdue → cancel, never a reschedule", () => {
    expect(dueReminderPlan(null, past, NOW)).toEqual({ action: "cancel" });
  });
});
