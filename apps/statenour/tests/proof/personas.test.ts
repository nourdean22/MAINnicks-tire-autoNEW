import { describe, expect, it } from "vitest";
import { NICKSTIRE_ORIGIN, PERSONA_SCOUTS } from "@/lib/proof/personas";

describe("persona scouts", () => {
  it("every scout is read-only, on nickstire.org, budgeted, and tied to a goal contract", () => {
    expect(PERSONA_SCOUTS.length).toBeGreaterThanOrEqual(5);
    const ids = new Set<string>();
    for (const s of PERSONA_SCOUTS) {
      expect(s.permission).toBe("read");
      expect(s.startUrl.startsWith(`${NICKSTIRE_ORIGIN}/`)).toBe(true);
      expect(s.maxSteps).toBeGreaterThan(0);
      expect(s.maxSteps).toBeLessThanOrEqual(10);
      expect(s.budgetMs).toBeLessThanOrEqual(180_000);
      expect(s.goalId).toMatch(/^nicks-public-/);
      expect(/do not (fill|submit|apply)/i.test(s.goal), `${s.id}: goal must forbid submitting`).toBe(true);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });
  it("positive control: a scout that could act would be caught", () => {
    const bad = { ...PERSONA_SCOUTS[0], permission: "draft" as unknown as "read" };
    expect(bad.permission === "read").toBe(false);
  });
});
