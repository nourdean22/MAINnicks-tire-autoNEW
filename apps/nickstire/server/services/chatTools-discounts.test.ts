/**
 * The site chat answers "do you have a discount?" through get_current_specials
 * (server/gemini.ts routes deals/discounts there). The /discounts pages advertise
 * DISCOUNT_PROGRAMS (shared/business.ts, Nour 2026-10-29: 20% off labor, up to
 * $250), so the tool must carry the same terms from the same config, or the
 * assistant tells a caller there is no such offer (Codex review on #3352).
 */
import { describe, it, expect, vi } from "vitest";
import { DISCOUNT_PROGRAMS } from "@shared/business";

// No database in this test: the specials table read must not reach the
// production DATABASE_URL a worktree carries (prod-db-guard).
vi.mock("../db", () => ({ getDb: async () => null }));

import { executeTool } from "./chatTools";

describe("get_current_specials carries the discount program from DISCOUNT_PROGRAMS", () => {
  it("states the configured offer, every qualifying group and the fine print", async () => {
    const r = JSON.parse(await executeTool("get_current_specials", {}));
    const program = r.discountProgram;
    expect(program, "discountProgram present").toBeTruthy();
    expect(program.offer).toBe(DISCOUNT_PROGRAMS.offer.display);
    expect(program.offer).toContain("20% off labor");
    expect(program.offer).toContain("$250");
    expect(program.finePrint).toEqual([...DISCOUNT_PROGRAMS.offer.finePrint]);
    const offerGroups = DISCOUNT_PROGRAMS.groups.filter((g) => g.offer);
    expect(program.whoQualifies.map((g: { group: string }) => g.group)).toEqual(offerGroups.map((g) => g.label));
    expect(program.details).toBe("nickstire.org/discounts");
  });

  it("never lists the LGBTQ+ welcome group as a discount", async () => {
    const r = JSON.parse(await executeTool("get_current_specials", {}));
    const groups = r.discountProgram.whoQualifies.map((g: { group: string }) => g.group);
    expect(groups.some((g: string) => /lgbtq/i.test(g))).toBe(false);
  });
});
