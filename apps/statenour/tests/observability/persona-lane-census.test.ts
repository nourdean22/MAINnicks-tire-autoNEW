/**
 * BDN-301 · persona-by-lane census regression armor.
 *
 * The property that matters is HONESTY UNDER CONFOUND: the census must
 * refuse to present a cross-lane spread as persona when the lanes were
 * fed different work. A census that silently ranks lanes on unequal
 * task mixes is worse than no census, because it looks like evidence.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_MIX_DIVERGENCE,
  MIN_CELL_N,
  parseLane,
  summarizePersonaByLane,
  type JudgmentRow,
} from "@/lib/observability/persona-lane-census";

function row(
  judgedBy: string,
  taskClass: string,
  scores: Partial<Record<"accuracy" | "actionability" | "brevity" | "tone" | "evidence", number>>,
): JudgmentRow {
  return { judgedBy, taskClass, scores };
}

/** n rows of one shape — keeps the mix-balancing in tests readable. */
function rows(count: number, r: JudgmentRow): JudgmentRow[] {
  return Array.from({ length: count }, () => r);
}

describe("persona-lane-census · lane parsing", () => {
  it("takes the provider, not the model", () => {
    expect(parseLane("anthropic:claude-opus-5")).toBe("anthropic");
    expect(parseLane("ollama:deepseek-v4-flash")).toBe("ollama");
  });

  it("maps judge-eval's unknown sentinel to 'unknown'", () => {
    // judge-eval writes `${provider ?? "?"}:${model ?? "?"}`.
    expect(parseLane("?:?")).toBe("unknown");
    expect(parseLane("")).toBe("unknown");
  });

  it("is case-insensitive on the provider", () => {
    expect(parseLane("Anthropic:Claude")).toBe("anthropic");
  });
});

describe("persona-lane-census · empty state", () => {
  it("reports unmeasured rather than zero", () => {
    const c = summarizePersonaByLane([]);
    expect(c.totalRows).toBe(0);
    expect(c.comparisons).toHaveLength(0);
    expect(c.disclosures.join(" ")).toContain("unmeasured, not unused");
  });
});

describe("persona-lane-census · the confound guard (load-bearing)", () => {
  it("marks spreads NOT comparable when lanes got different work", () => {
    // ollama sees only quick checks, anthropic only strategy — the
    // classic routing confound. Tone differs, but the difference is
    // uninterpretable.
    const data: JudgmentRow[] = [
      ...rows(10, row("ollama:deepseek-v4-flash", "quick_check", { tone: 5 })),
      ...rows(10, row("anthropic:claude-opus-5", "strategy", { tone: 9 })),
    ];
    const c = summarizePersonaByLane(data);
    expect(c.mixDivergence).toBeGreaterThan(MAX_MIX_DIVERGENCE);
    const tone = c.comparisons.find((x) => x.axis === "tone");
    expect(tone?.spread).toBeCloseTo(4, 5);
    expect(tone?.comparable).toBe(false);
    expect(c.disclosures.join(" ")).toContain("ROUTING, not persona");
  });

  it("marks spreads comparable when both lanes got the same mix", () => {
    const data: JudgmentRow[] = [
      ...rows(10, row("ollama:deepseek-v4-flash", "quick_check", { tone: 6 })),
      ...rows(10, row("ollama:deepseek-v4-flash", "strategy", { tone: 6 })),
      ...rows(10, row("anthropic:claude-opus-5", "quick_check", { tone: 8 })),
      ...rows(10, row("anthropic:claude-opus-5", "strategy", { tone: 8 })),
    ];
    const c = summarizePersonaByLane(data);
    expect(c.mixDivergence).toBe(0);
    const tone = c.comparisons.find((x) => x.axis === "tone");
    expect(tone?.comparable).toBe(true);
    expect(tone?.spread).toBeCloseTo(2, 5);
  });

  it("never reports a cross-lane comparison from a single lane", () => {
    const c = summarizePersonaByLane(rows(20, row("ollama:x", "quick_check", { tone: 7 })));
    expect(c.comparisons).toHaveLength(0);
    expect(c.disclosures.join(" ")).toContain("Only one lane");
  });
});

describe("persona-lane-census · cells", () => {
  it("keeps underpowered cells visible instead of dropping them", () => {
    // BDN-105 lesson: dropping rows that never reached the gate made a
    // never-run process look adequately sampled.
    const data = [
      ...rows(MIN_CELL_N + 2, row("ollama:x", "quick_check", { tone: 7 })),
      row("ollama:x", "strategy", { tone: 3 }),
    ];
    const c = summarizePersonaByLane(data);
    const thin = c.cells.find((x) => x.taskClass === "strategy");
    expect(thin).toBeDefined();
    expect(thin?.n).toBe(1);
    expect(thin?.underpowered).toBe(true);
    expect(c.disclosures.join(" ")).toContain(`n < ${MIN_CELL_N}`);
  });

  it("omits an axis that was never scored rather than recording it as 0", () => {
    const c = summarizePersonaByLane(rows(6, row("ollama:x", "quick_check", { tone: 7 })));
    const cell = c.cells[0];
    expect(cell.means.tone).toBeCloseTo(7, 5);
    expect(cell.means.accuracy).toBeUndefined();
  });

  it("ignores non-numeric and non-finite scores without poisoning the mean", () => {
    const data: JudgmentRow[] = [
      row("ollama:x", "quick_check", { tone: 8 }),
      row("ollama:x", "quick_check", { tone: Number.NaN }),
      row("ollama:x", "quick_check", { tone: 6 }),
    ];
    const cell = summarizePersonaByLane(data).cells[0];
    expect(cell.means.tone).toBeCloseTo(7, 5);
  });

  it("treats a blank taskClass as explicit 'unknown'", () => {
    const c = summarizePersonaByLane([row("ollama:x", "  ", { tone: 5 })]);
    expect(c.cells[0].taskClass).toBe("unknown");
  });

  it("discloses rows whose provider never resolved", () => {
    const c = summarizePersonaByLane([
      ...rows(6, row("?:?", "quick_check", { tone: 5 })),
      ...rows(6, row("ollama:x", "quick_check", { tone: 5 })),
    ]);
    expect(c.disclosures.join(" ")).toContain("no resolvable provider");
  });
});
