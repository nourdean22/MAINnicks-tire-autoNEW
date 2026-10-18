/**
 * pickTopTires: the three "top picks" cards on /tires are derived client-side
 * from the publicSearch result. These pin the selection rules so a card can
 * never repeat a tire, never show a missing price, and never invent a tier.
 */
import { describe, it, expect } from "vitest";
import { pickTopTires, setTotalLabel } from "@/lib/tirePicks";

type T = { id: string; category: "budget" | "mid" | "premium"; shopPrice: number };
const t = (id: string, category: T["category"], shopPrice: number): T => ({ id, category, shopPrice });

describe("pickTopTires", () => {
  it("picks the cheapest overall, the cheapest mid-range and the cheapest premium", () => {
    const picks = pickTopTires([
      t("p2", "premium", 160), t("b1", "budget", 70), t("m2", "mid", 92),
      t("b2", "budget", 75), t("m1", "mid", 88), t("p1", "premium", 140),
    ]);
    expect(picks.map((p) => [p.kind, p.tire.id])).toEqual([
      ["lowest", "b1"], ["value", "m1"], ["premium", "p1"],
    ]);
  });

  it("never shows the same tire twice: a mid-range tire that is also the cheapest is not repeated", () => {
    const picks = pickTopTires([t("m1", "mid", 60), t("b1", "budget", 65), t("p1", "premium", 150)]);
    expect(picks.map((p) => p.tire.id)).toEqual(["m1", "p1"]);
    expect(new Set(picks.map((p) => p.tire.id)).size).toBe(picks.length);
  });

  it("with fewer than three distinct picks returns only the distinct ones", () => {
    expect(pickTopTires([t("b1", "budget", 95.5), t("p1", "premium", 150)]).map((p) => p.kind))
      .toEqual(["lowest", "premium"]);
    expect(pickTopTires([t("b1", "budget", 80), t("b2", "budget", 90)]).map((p) => p.kind))
      .toEqual(["lowest"]);
    expect(pickTopTires([])).toEqual([]);
  });

  it("a tire with a missing, zero or NaN price never becomes a pick", () => {
    const picks = pickTopTires([
      t("zero", "budget", 0), t("nan", "mid", Number.NaN), t("neg", "premium", -5),
      t("b1", "budget", 80), t("m1", "mid", 95),
    ]);
    expect(picks.map((p) => p.tire.id)).toEqual(["b1", "m1"]);
  });
});

describe("setTotalLabel (shared by the list and the top-pick cards)", () => {
  it("renders the set total exactly as the list always has", () => {
    expect(setTotalLabel(95.5, 4)).toBe("$382.00 for 4");
    expect(setTotalLabel(100, 2)).toBe("$200.00 for 2");
    expect(setTotalLabel(89.99, 1)).toBe("$89.99 for 1");
  });
});
