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
  CENSUS_AXES,
  JUDGE_AXES,
  MAX_MIX_DIVERGENCE,
  MIN_CELL_N,
  PERSONA_AXES,
  parseLane,
  summarizePersonaByLane,
  type JudgmentRow,
} from "@/lib/observability/persona-lane-census";

function row(
  judgedBy: string,
  taskClass: string,
  scores: JudgmentRow["scores"],
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

describe("persona-lane-census · persona axes (2026-08-18)", () => {
  it("aggregates the three persona axes alongside the core five", () => {
    expect(CENSUS_AXES).toEqual([...JUDGE_AXES, ...PERSONA_AXES]);
    expect(PERSONA_AXES).toEqual(["obedience", "nonSycophancy", "calibration"]);

    const data: JudgmentRow[] = [
      ...rows(6, row("ollama:x", "quick_check", { obedience: 9, nonSycophancy: 4, tone: 7 })),
    ];
    const cell = summarizePersonaByLane(data).cells[0];
    expect(cell.means.obedience).toBeCloseTo(9, 5);
    expect(cell.means.nonSycophancy).toBeCloseTo(4, 5);
    expect(cell.means.calibration).toBeUndefined(); // never scored → absent, not 0
  });

  it("compares persona axes cross-lane under the SAME confound guard as core axes", () => {
    const data: JudgmentRow[] = [
      ...rows(10, row("ollama:x", "quick_check", { obedience: 5 })),
      ...rows(10, row("anthropic:y", "quick_check", { obedience: 9 })),
    ];
    const c = summarizePersonaByLane(data);
    const obedience = c.comparisons.find((x) => x.axis === "obedience");
    expect(obedience?.spread).toBeCloseTo(4, 5);
    expect(obedience?.comparable).toBe(true);
  });

  it("historical rows without persona axes never poison persona means", () => {
    // Pre-2026-08-18 reply_judgment rows carry only the core five. Mixing
    // eras must yield the persona mean over ONLY the rows that scored it.
    const data: JudgmentRow[] = [
      ...rows(5, row("ollama:x", "quick_check", { tone: 7 })), // historical era
      ...rows(5, row("ollama:x", "quick_check", { tone: 7, obedience: 8 })), // new era
    ];
    const cell = summarizePersonaByLane(data).cells[0];
    expect(cell.n).toBe(10);
    expect(cell.means.obedience).toBeCloseTo(8, 5); // mean of 5 scored rows, not 10
  });
});

describe("persona-lane-census · the unstratified trap (self-audit fix)", () => {
  it("refuses to call an ALL-UNKNOWN comparison comparable", () => {
    // Nothing in the app records taskClass today (judge-eval persists
    // only judgedBy + rubric). Every row therefore arrives "unknown",
    // both lanes get an identical one-bucket mix, and total-variation
    // distance is 0 — which the original guard read as "safe to
    // compare". It would have certified a completely unstratified
    // comparison. Identically-stratified and not-stratified-at-all are
    // different facts.
    const data: JudgmentRow[] = [
      ...rows(10, row("ollama:deepseek-v4-flash", "unknown", { tone: 5 })),
      ...rows(10, row("anthropic:claude-opus-5", "unknown", { tone: 9 })),
    ];
    const c = summarizePersonaByLane(data);
    expect(c.mixDivergence).toBe(0); // the metric still says "identical"
    expect(c.comparisons.find((x) => x.axis === "tone")?.comparable).toBe(false);
    expect(c.disclosures.join(" ")).toContain("UNSTRATIFIED");
  });

  it("becomes comparable once ANY row carries a real taskClass", () => {
    const data: JudgmentRow[] = [
      ...rows(10, row("ollama:x", "quick_check", { tone: 6 })),
      ...rows(10, row("anthropic:y", "quick_check", { tone: 8 })),
    ];
    const c = summarizePersonaByLane(data);
    expect(c.comparisons.find((x) => x.axis === "tone")?.comparable).toBe(true);
  });

  it("still refuses when one lane is entirely unknown and the other is not", () => {
    // Mixed case: the divergence metric would flag this anyway, but the
    // stratification check must not accidentally re-enable it.
    const data: JudgmentRow[] = [
      ...rows(10, row("ollama:x", "unknown", { tone: 6 })),
      ...rows(10, row("anthropic:y", "strategy", { tone: 9 })),
    ];
    const c = summarizePersonaByLane(data);
    expect(c.comparisons.find((x) => x.axis === "tone")?.comparable).toBe(false);
  });
});
