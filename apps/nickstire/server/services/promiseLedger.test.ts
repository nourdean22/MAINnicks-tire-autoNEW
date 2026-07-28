/**
 * Promise Ledger · doctrine tests (pure surface).
 *
 * Pins: overdue classification + escalation urgency (≥4h overdue =
 * critical), and the kept-requires-evidence rule at its cheapest
 * enforcement point (the service rejects empty evidence before any DB
 * import — provably no write).
 */
import { describe, it, expect } from "vitest";
import { classifyOverdue, keepPromise, PROMISE_TYPES } from "./promiseLedger";

describe("classifyOverdue", () => {
  const now = new Date("2026-07-28T15:00:00Z");

  it("not yet due → not overdue", () => {
    const r = classifyOverdue(new Date("2026-07-28T16:00:00Z"), now);
    expect(r.overdue).toBe(false);
  });

  it("1h overdue → today urgency", () => {
    const r = classifyOverdue(new Date("2026-07-28T14:00:00Z"), now);
    expect(r.overdue).toBe(true);
    expect(r.hoursOverdue).toBe(1);
    expect(r.urgency).toBe("today");
  });

  it("4h+ overdue → critical (a broken promise in the customer's eyes)", () => {
    const r = classifyOverdue(new Date("2026-07-28T10:30:00Z"), now);
    expect(r.hoursOverdue).toBe(4);
    expect(r.urgency).toBe("critical");
  });
});

describe("kept requires evidence", () => {
  it("empty or trivial evidence is rejected before any DB work", async () => {
    for (const evidence of ["", "  ", "ok"]) {
      const res = await keepPromise({ id: "00000000-0000-0000-0000-000000000000", evidence, by: "test" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/evidence/);
    }
  });
});

describe("promise vocabulary", () => {
  it("covers the plan's promise types", () => {
    for (const t of ["callback", "estimate", "status_update", "parts_arrival", "completion_notice", "manager_followup"]) {
      expect(PROMISE_TYPES).toContain(t);
    }
  });
});
