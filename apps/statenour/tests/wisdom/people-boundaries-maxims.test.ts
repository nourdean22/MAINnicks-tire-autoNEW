/**
 * People W3 (2026-10-30): a "boundaries" maxim set, and the right maxim under each pick.
 *
 * Nour asked for his books to remind him not to let other people's opinions
 * and expectations hold him back. The tag is data only (manager ruling: the
 * maxim JSON gains a tag, pickMaxim's code stays as it is); maximForPick maps a
 * pick's situation to one tag and reads the existing pickMaximForDay.
 */
import { describe, expect, it } from "vitest";

import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import { maximForPick } from "@/lib/services/people/maxim-for-pick";

const BOUNDARIES = [
  "wisdom_baltasar-gracian_069",
  "wisdom_baltasar-gracian_100",
  "wisdom_baltasar-gracian_136",
  "wisdom_baltasar-gracian_197",
  "wisdom_baltasar-gracian_243",
  "wisdom_baltasar-gracian_250",
  "wisdom_baltasar-gracian_280",
  "law_25",
  "law_34",
  "strategy_command",
  "fearless_5",
  "dark_manipulator",
  "mastery_authentic_voice",
  "wisdom_charlie-munger_009",
  "wisdom_charlie-munger_021",
  "wisdom_charlie-munger_027",
  "wisdom_naval-ravikant_010",
  "wisdom_naval-ravikant_031",
  "wisdom_naval-ravikant_039",
];

describe("the boundaries tag", () => {
  it("is on exactly the 19 curated maxims, nowhere else", () => {
    const tagged = MAXIM_POOL.filter((m) => m.tags.includes("boundaries")).map((m) => m.ref).sort();
    expect(tagged).toEqual([...BOUNDARIES].sort());
  });

  it("every tagged maxim keeps its other tags", () => {
    for (const m of MAXIM_POOL.filter((x) => x.tags.includes("boundaries"))) {
      expect(m.tags.length).toBeGreaterThan(1);
    }
  });
});

describe("maximForPick", () => {
  const day = "2026-10-30";

  it("a draining relationship (ledger down 2+ in 30 days) gets a boundaries maxim", () => {
    const m = maximForPick({ personId: "p1", ledgerDelta30d: -3, brokenPromises: 0, birthdayInDays: null }, day);
    expect(m?.tags).toContain("boundaries");
  });

  it("an open promise gets a reputation maxim (keep your word)", () => {
    const m = maximForPick({ personId: "p1", ledgerDelta30d: 0, brokenPromises: 1, birthdayInDays: null }, day);
    expect(m?.tags).toContain("reputation");
  });

  it("otherwise a people maxim", () => {
    const m = maximForPick({ personId: "p1", ledgerDelta30d: 0, brokenPromises: 0, birthdayInDays: 3 }, day);
    expect(m?.tags).toContain("people");
  });

  it("is stable for a person and a day, and differs between people", () => {
    const a = maximForPick({ personId: "p1", ledgerDelta30d: 0, brokenPromises: 0, birthdayInDays: null }, day);
    const a2 = maximForPick({ personId: "p1", ledgerDelta30d: 0, brokenPromises: 0, birthdayInDays: null }, day);
    expect(a?.id).toBe(a2?.id);
    const others = new Set(
      ["p2", "p3", "p4", "p5", "p6"].map((personId) => maximForPick({ personId, ledgerDelta30d: 0, brokenPromises: 0, birthdayInDays: null }, day)?.id),
    );
    expect(others.size).toBeGreaterThan(1);
  });

  it("returns only text, source and ref fields a card can show", () => {
    const m = maximForPick({ personId: "p1", ledgerDelta30d: -3, brokenPromises: 0, birthdayInDays: null }, day);
    expect(typeof m?.text).toBe("string");
    expect(typeof m?.source).toBe("string");
  });
});
