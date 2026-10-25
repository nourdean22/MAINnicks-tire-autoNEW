/**
 * Memory-tab label-honesty canaries · 2026-09-02
 *
 * The defects fixed here were LABELS, so these assert on the rendered source
 * of components/brain/memory-tab.tsx.
 *
 * Comments are stripped before every assertion. Without that these tests pass
 * on their own explanatory prose: the component's comments legitimately quote
 * the old strings ("vs 30d ago", "wisdom promotions") while explaining why
 * they are gone, so an un-stripped search would find them and report the
 * defect as still present -- or worse, find them and report the FIX as
 * present when only the comment survived.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Wave D (2026-10-24): the learning-velocity scoreboard moved to its own file (it renders on the Health
// tab now) and the shared unavailable line moved to brain-fold.tsx, so the labels are read across all three.
// Wave E2 (2026-10-24): the calibration tile moved to Stats Goals (components/stats/calibration-tile.tsx);
// its contract moved with it.
const SOURCES = [
  ...["memory-tab.tsx", "learning-velocity-scoreboard.tsx", "brain-fold.tsx"].map((f) => path.resolve(__dirname, "../../../components/brain", f)),
  path.resolve(__dirname, "../../../components/stats/calibration-tile.tsx"),
];
const RAW = SOURCES.map((f) => readFileSync(f, "utf8")).join("\n");

/** Source with block and line comments removed. */
const code = RAW
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*/g, "");

describe("comment stripping", () => {
  it("actually removes the commentary that quotes the old labels", () => {
    const raw = RAW;
    // Guards the guard: if this ever fails, every assertion below is
    // meaningless because it would be reading prose instead of JSX.
    expect(raw).toContain("vs 30d ago");
    expect(code).not.toContain("vs 30d ago");
  });
});

describe("learning velocity headline", () => {
  it("does not claim a 30-day brain comparison", () => {
    // "brain {sign}{n}% vs 30d ago" came from a composite with no 30-day
    // term in it.
    expect(code).not.toContain("vs 30d ago");
    expect(code).not.toMatch(/brain \{/);
  });

  it("attributes the 30-day change to memories, which is what it measures", () => {
    expect(code).toContain("memories ${pct > 0");
    expect(code).toContain("vs prior 30d");
  });

  it("says so when the prior window is empty instead of rendering a number", () => {
    // pctChange === null must not fall through to a bare 0%.
    expect(code).toContain("no prior window to compare");
    expect(code).toMatch(/pct === null/);
  });

  it("renders health out of the max actually available, not a hardcoded 100", () => {
    expect(code).toContain("{data.healthScore}/{data.healthScoreMax}");
    expect(code).not.toContain("healthScore}/100");
  });
});

describe("scoreboard cells name their own window", () => {
  const labels = [
    "memories · 7d",
    "wisdom rows · 30d",
    "connections · 30d",
    "contradictions resolved · 30d",
  ];

  it.each(labels)("labels the %s cell with its window", (label) => {
    expect(code).toContain(`label="${label}"`);
  });

  it("no longer renders a bare unwindowed cell label", () => {
    // The four cells were "memories +", "wisdom +", "connections +" and
    // "contradictions resolved" -- a 7d count, two 30d counts and one
    // LIFETIME running total, under one "velocity" heading.
    expect(code).not.toContain('label="memories +"');
    expect(code).not.toContain('label="wisdom +"');
    expect(code).not.toContain('label="connections +"');
    expect(code).not.toContain('label="contradictions resolved"');
  });

  it("reads the 30d contradiction count, not the lifetime total", () => {
    expect(code).toContain("data.contradictionsResolved30d");
    expect(code).not.toMatch(/data\.contradictionsResolved\b/);
  });

  it("calls wisdom what it counts -- rows created, not promotions", () => {
    expect(code).toContain("data.wisdomCreated30d");
    expect(code).not.toContain("wisdomPromotions");
  });
});

describe("calibration tile", () => {
  it("labels the population as resolved-in-window", () => {
    expect(code).toContain("Predictions resolved in 30 days");
  });
});

describe("read failure is distinguishable from emptiness", () => {
  it("has one shared unavailable state carrying the established copy", () => {
    expect(code).toContain("state unknown, not empty");
  });

  it.each(["Learning velocity", "Identity delta", "Calibration"])(
    "renders the unavailable state for %s",
    (label) => {
      expect(code).toContain(`<ReadingUnavailable label="${label}" />`);
    },
  );

  it("subscribes to isError on all three queries", () => {
    const isErrorDestructures = code.match(/isError/g) ?? [];
    // 3 destructures + 3 guards.
    expect(isErrorDestructures.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps silent-when-empty for a genuinely quiet calibration window", () => {
    // Emptiness still hides; only failure speaks.
    // Emptiness still hides (StaleNote renders nothing unless the last refresh failed, wave D round 6).
    expect(code).toContain("data.resolved === 0) return <StaleNote q={calibrationQ}");
  });
});
