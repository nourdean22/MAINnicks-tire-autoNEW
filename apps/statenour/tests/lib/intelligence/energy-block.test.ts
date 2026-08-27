/**
 * Completion timing reaches the brief. Durations, which nobody records, do not.
 *
 * `energy-router` reported `totalSamples: 0` for its whole life, and I twice
 * told the operator to leave it dark on that basis. The output was indeed
 * unusable; the diagnosis was wrong. The module filtered its query on
 * `actualMinutes > 0` — a column nothing writes, whose NOT NULL default of 0
 * makes it look populated (measured 2026-08-27: 268 of 268 rows non-null, 0 of
 * 268 above zero). That single predicate discarded 124 real completion
 * timestamps. The data was there; the query refused to look at it.
 *
 * Removing the filter naively would have been WORSE than leaving it dark:
 *   · `overage = actualMinutes - expected` = `0 - 15` → every task reported as
 *     finishing 15 minutes EARLY, quoted to the minute in a live suggestion
 *   · `confidence = tasks.length / 50` → 1.0, full confidence on empty input
 *   · `recommendWindow` gates on `totalSamples < 10`, which 124 clears — so it
 *     would name a best window for HIGH-energy work from a population of 4,
 *     spread one per window
 *
 * The last one is the base-rate error in code: a subgroup claim validated by
 * the count of the population it was filtered out of. Hence MIN_BAND_SAMPLES,
 * and hence this file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderEnergyBlock } from "@/lib/intelligence/energy-block";
import { recommendWindow, MIN_BAND_SAMPLES, type EnergyProfile } from "@/lib/personal/energy-router";

/** The shape prod returned on 2026-08-27. Nothing is timed. */
const LIVE: EnergyProfile = {
  windows: {
    morning: { count: 55, avgOverageMinutes: null, overageSamples: 0, highEnergyCount: 2 },
    afternoon: { count: 32, avgOverageMinutes: null, overageSamples: 0, highEnergyCount: 0 },
    evening: { count: 7, avgOverageMinutes: null, overageSamples: 0, highEnergyCount: 1 },
    late: { count: 30, avgOverageMinutes: null, overageSamples: 0, highEnergyCount: 1 },
  },
  bestForHighEnergy: null,
  bestForLowEnergy: "morning",
  confidence: 1,
  totalSamples: 124,
  durationSamples: 0,
};

/** A hypothetical future where durations are actually recorded. */
const TIMED: EnergyProfile = {
  ...LIVE,
  windows: {
    ...LIVE.windows,
    morning: { count: 55, avgOverageMinutes: 12.4, overageSamples: 9, highEnergyCount: 5 },
    afternoon: { count: 32, avgOverageMinutes: -3.2, overageSamples: 4, highEnergyCount: 4 },
  },
  bestForHighEnergy: "morning",
  durationSamples: 13,
};

describe("renderEnergyBlock · timing, verbatim", () => {
  it("prints the real counts per window", () => {
    const out = renderEnergyBlock(LIVE);
    expect(out).toContain("124 completions in 90d");
    expect(out).toContain("morning (6-11) 55");
    expect(out).toContain("evening (17-20) 7");
  });

  it("orders by volume, so the biggest window reads first", () => {
    const out = renderEnergyBlock(LIVE);
    expect(out.indexOf("morning (6-11) 55")).toBeLessThan(out.indexOf("evening (17-20) 7"));
  });

  it("THE BAND GATE: 4 HIGH-energy tasks name no window, and say why", () => {
    const out = renderEnergyBlock(LIVE);
    expect(out).toContain("HIGH-energy tasks: 4 of 124");
    expect(out).toMatch(/Too few/i);
    expect(out).toContain(String(MIN_BAND_SAMPLES));
    // The failure this guards: naming a winner from a 1/1/1/1 split.
    expect(out).not.toMatch(/most in \*\*/);
  });

  it("names a window once the band clears the floor", () => {
    const out = renderEnergyBlock(TIMED);
    expect(out).toContain("most in **morning");
    expect(out).not.toMatch(/Too few/i);
  });

  it("NEVER fabricates an overage when nothing was timed", () => {
    // The whole point. `actualMinutes` is 0 for every row, so any minute figure
    // here would be `0 - expected` presented as a measurement.
    const out = renderEnergyBlock(LIVE);
    expect(out).toContain("UNMEASURED");
    expect(out).not.toMatch(/\d+\s*min/);
    expect(out).toMatch(/nothing records how long a task took/i);
  });

  it("renders real overages when durations exist, with their sample counts", () => {
    const out = renderEnergyBlock(TIMED);
    expect(out).toContain("Measured durations (13)");
    expect(out).toContain("+12min over 9");
    expect(out).toContain("-3min over 4");
    expect(out).not.toContain("UNMEASURED");
  });

  it("EMPTY IS NOT UNMEASURED", () => {
    const measured = renderEnergyBlock({ ...LIVE, totalSamples: 0 });
    expect(measured).toMatch(/no tasks completed/i);
    expect(measured).not.toContain("UNMEASURED");

    const failed = renderEnergyBlock(null);
    expect(failed).toContain("UNMEASURED");
    expect(failed).toMatch(/not a claim/i);
  });

  it("POSITIVE CONTROL: a real render is substantial, not a bare heading", () => {
    const out = renderEnergyBlock(LIVE);
    expect(out.split("\n").filter((l) => l.trim()).length).toBeGreaterThan(3);
    expect(out).toContain("## Energy · when work lands");
  });
});

describe("recommendWindow · a recommendation needs samples of the thing recommended", () => {
  it("does not quote an overage it never measured", () => {
    // Was: `lowest overage (15min) in afternoon window` — computed from a
    // column of zeros and printed to the minute.
    for (const band of ["LOW", "MEDIUM", "HIGH"] as const) {
      const r = recommendWindow(band, LIVE);
      expect(r.reason, `${band} leaked a duration claim`).not.toMatch(/lowest measured overage/);
      if (/min/.test(r.reason)) expect(r.reason).toMatch(/UNMEASURED/);
    }
  });

  it("falls back to the busiest window and labels it as timing only", () => {
    const r = recommendWindow("MEDIUM", LIVE);
    expect(r.window).toBe("morning");
    expect(r.reason).toContain("most completions (55)");
    expect(r.reason).toMatch(/UNMEASURED/);
    expect(r.confidence).toBeLessThan(LIVE.confidence);
  });

  it("HIGH gets no band-specific answer while bestForHighEnergy is null", () => {
    const r = recommendWindow("HIGH", LIVE);
    expect(r.reason).not.toMatch(/HIGH-energy tasks completed/);
  });

  it("uses the measured overage once it exists", () => {
    const r = recommendWindow("MEDIUM", TIMED);
    expect(r.reason).toContain("lowest measured overage");
    expect(r.reason).toMatch(/over \d+ timed tasks/);
  });

  it("still short-circuits on a genuinely tiny table", () => {
    const tiny = { ...LIVE, totalSamples: 3 };
    expect(recommendWindow("HIGH", tiny).reason).toMatch(/not enough completions/);
  });
});

describe("the source · the filter that made this module dark", () => {
  const router = () =>
    readFileSync("lib/personal/energy-router.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("THE FIX: the query does not filter on actualMinutes", () => {
    // One predicate on an empty column cost this module every sample it ever
    // had. Comments stripped first — the file explains the filter at length.
    expect(router()).not.toMatch(/actualMinutes:\s*\{\s*gt:\s*0\s*\}/);
  });

  it("overage is averaged over TIMED rows, never over completions", () => {
    const code = router();
    expect(code).toContain("overageSamples");
    // The dilution bug: dividing a handful of real durations by the completion
    // count. `slot.count` must not appear in the overage average.
    expect(code).not.toMatch(/avgOverageMinutes\s*=\s*\([^)]*slot\.count/);
  });

  it("the band gate is applied to both recommendations", () => {
    const code = router();
    expect(code).toContain("MIN_BAND_SAMPLES");
    expect(code).toMatch(/highTotal\s*>=\s*MIN_BAND_SAMPLES/);
    expect(code).toMatch(/lowTotal\s*>=\s*MIN_BAND_SAMPLES/);
  });
});

describe("the wiring · the brief gets it verbatim", () => {
  const composer = () => readFileSync("lib/intelligence/compose-daily-brief.ts", "utf8");

  it("renders it and it reaches the returned text", () => {
    const src = composer();
    expect(src).toContain("renderEnergyBlock");
    expect(src).toContain("buildEnergyProfile");
    expect(src).toMatch(/\$\{energyBlock\}/);
  });

  it("THE CONTRACT: energyBlock is NOT handed to generateText", () => {
    const src = composer();
    const promptStart = src.indexOf("const promptText =");
    const promptEnd = src.indexOf("const queue = await loadOperatorQueue()");
    expect(promptStart).toBeGreaterThan(-1);
    expect(promptEnd).toBeGreaterThan(promptStart);
    const region = src.slice(promptStart, promptEnd);
    expect(region).not.toContain("energyBlock");
    expect(region).not.toContain("buildEnergyProfile");
  });

  it("a failed read cannot take the block with it", () => {
    const src = composer();
    const at = src.indexOf("renderEnergyBlock(await buildEnergyProfile())");
    expect(at).toBeGreaterThan(-1);
    const around = src.slice(Math.max(0, at - 300), at + 500);
    expect(around).toMatch(/try\s*\{/);
    expect(around).toMatch(/renderEnergyBlock\(null\)/);
  });
});
