/**
 * Close the day only says "rolled" for what actually rolled (job 2026-10-23,
 * map F8b: the snooze handler swallowed its own error, so the success toast
 * fired over a failed write).
 */
import { describe, expect, it, vi } from "vitest";
import { rollStragglers, rollSummary } from "@/lib/missions/roll-day";

describe("rollStragglers", () => {
  it("one failed snooze: the result names it, and the summary never says all rolled", async () => {
    const snooze = vi.fn(async (id: string) => id !== "t2");
    const r = await rollStragglers(["t1", "t2", "t3"], snooze);
    expect(r).toEqual({ rolled: 2, failed: 1 });
    const msg = rollSummary(r, 4);
    expect(msg.ok).toBe(false);
    expect(msg.text).toBe("2 moved to tomorrow, 1 could not be moved. They are still open; try again.");
  });

  it("a thrown snooze counts as failed, not rolled", async () => {
    const r = await rollStragglers(["t1"], async () => {
      throw new Error("network");
    });
    expect(r).toEqual({ rolled: 0, failed: 1 });
    expect(rollSummary(r, 0).ok).toBe(false);
  });

  it("all succeed: one plain receipt", async () => {
    const r = await rollStragglers(["t1", "t2"], async () => true);
    expect(rollSummary(r, 3)).toEqual({ ok: true, text: "Day closed. 3 done, 2 moved to tomorrow." });
  });
});
