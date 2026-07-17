/**
 * Specialist critic panel (milestone 9 §59) — the merge is the load-bearing
 * logic: dedupe cross-lens findings, keep the strongest severity, and let ANY
 * block force repair. A single hard fail must never be averaged away by clean
 * lenses (the directive's core objection to one composite score).
 */
import { describe, expect, it } from "vitest";
import { CRITIC_LENSES, mergePanel, type CriticLens } from "./services/criticPanel";
import type { RenderedQaVerdict } from "./services/renderedQa";

const v = (findings: RenderedQaVerdict["findings"], critic: "vision" | "skipped" = "vision"): RenderedQaVerdict => ({
  decision: findings.some((f) => f.severity === "block") ? "repair" : "approve",
  findings,
  framesEvaluated: 8,
  evaluatedAt: "t",
  critic,
});

describe("mergePanel", () => {
  it("all lenses clean -> approve, nothing merged", () => {
    const r = mergePanel([
      { lens: "automotive", verdict: v([]) },
      { lens: "typography", verdict: v([]) },
    ]);
    expect(r.decision).toBe("approve");
    expect(r.findings).toEqual([]);
    expect(r.lensesRun).toEqual(["automotive", "typography"]);
  });

  it("ONE block among six clean lenses still forces repair (never averaged)", () => {
    const block = { beatNumber: 3, code: "MALFORMED_GEOMETRY" as const, severity: "block" as const, description: "warped wheel", preserve: [], change: [] };
    const r = mergePanel([
      { lens: "visual_continuity", verdict: v([]) },
      { lens: "automotive", verdict: v([block]) },
      { lens: "editorial", verdict: v([]) },
      { lens: "typography", verdict: v([]) },
      { lens: "brand", verdict: v([]) },
      { lens: "strategic", verdict: v([]) },
    ]);
    expect(r.decision).toBe("repair");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].code).toBe("MALFORMED_GEOMETRY");
  });

  it("the same (code,beat) from two lenses dedupes and unions the lens tags", () => {
    const finding = { beatNumber: 1, code: "GENERATED_TEXT_ARTIFACT" as const, severity: "block" as const, description: "gibberish", preserve: [], change: [] };
    const r = mergePanel([
      { lens: "typography", verdict: v([finding]) },
      { lens: "visual_continuity", verdict: v([{ ...finding }]) },
    ]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].lenses.sort()).toEqual(["typography", "visual_continuity"]);
  });

  it("stronger severity wins when lenses disagree on the same finding", () => {
    const key = { beatNumber: 2, code: "PALETTE_DRIFT" as const, description: "drift", preserve: [], change: [] };
    const r = mergePanel([
      { lens: "brand", verdict: v([{ ...key, severity: "warn" }]) },
      { lens: "visual_continuity", verdict: v([{ ...key, severity: "block" }]) },
    ]);
    expect(r.findings[0].severity).toBe("block");
    expect(r.decision).toBe("repair");
  });

  it("a skipped lens is recorded, not counted as clean", () => {
    const r = mergePanel([
      { lens: "automotive", verdict: v([], "skipped") },
      { lens: "typography", verdict: null },
      { lens: "brand", verdict: v([]) },
    ]);
    expect(r.lensesSkipped.sort()).toEqual(["automotive", "typography"]);
    expect(r.lensesRun).toEqual(["brand"]);
  });

  it("findings sort blocks before warns", () => {
    const warn = { beatNumber: 1, code: "WEAK_COMPOSITION" as const, severity: "warn" as const, description: "w", preserve: [], change: [] };
    const block = { beatNumber: 2, code: "HUMAN_PRESENT" as const, severity: "block" as const, description: "b", preserve: [], change: [] };
    const r = mergePanel([{ lens: "composition", verdict: v([warn, block]) }]);
    expect(r.findings[0].severity).toBe("block");
    expect(r.findings[1].severity).toBe("warn");
  });

  it("every lens covers a real concern (7 lenses defined)", () => {
    const lenses = Object.keys(CRITIC_LENSES) as CriticLens[];
    expect(lenses).toHaveLength(7);
    for (const l of lenses) expect(CRITIC_LENSES[l].focus.length).toBeGreaterThan(20);
  });
});
