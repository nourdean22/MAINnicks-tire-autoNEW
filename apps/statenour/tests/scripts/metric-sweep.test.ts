/**
 * Canaries for the metric-lane sweep's matchers.
 *
 * WHY THIS FILE EXISTS — the sweep shipped in #2397 reporting
 * "5 metric lanes written · 1 lane nothing reads". Both numbers were wrong, and
 * wrong in the flattering direction. The honest figures are 14 and 8.
 *
 * 1. WRITER DISCOVERY SAW ONE SHAPE. It matched `recordMetric…("name"` only,
 *    while a dozen files write straight through
 *    `prisma.systemMetric.create({ data: { metric: "name" } })`. Nine lanes were
 *    invisible, and an invisible lane is silently exempt from the orphan check.
 *
 * 2. THE PROBE COUNTED ITSELF AS A READER. It scans `scripts/`, so it scans
 *    itself; its source contains `systemMetric` — inside the very regex that
 *    detects readers — and every lane name from its own positive control. It
 *    therefore reported itself as the DATA reader for `action.done.shadow` and
 *    `operation.integrity_shadow`, hiding two of the three orphans it existed
 *    to surface.
 *
 * ★ An instrument that scans the tree it lives in must exclude itself, or it
 *   reports its own existence as coverage.
 */
import { describe, it, expect } from "vitest";
import {
  collectLiteralWrites,
  excludeSelf,
  isDataReader,
  WRITE_DIRECT,
} from "../../scripts/lib/metric-sweep.mjs";

const RECORD_METRIC_SRC = `
  await recordMetric("tool.surfaced", tools.length, "count");
`;

/** Verbatim shape from lib/ai/agents/router-metrics.ts. */
const DIRECT_PRISMA_SRC = `
  await prisma.systemMetric.create({
    data: {
      metric: "specialist.route",
      value: confidence,
      unit: "confidence",
    },
  });
`;

describe("collectLiteralWrites", () => {
  it("finds a recordMetric literal", () => {
    expect(collectLiteralWrites(RECORD_METRIC_SRC)).toContain("tool.surfaced");
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // This is the whole defect: without WRITE_DIRECT the direct-Prisma shape
  // yields nothing and the lane never enters the inventory.
  it("CANARY — finds a direct prisma.systemMetric.create write", () => {
    expect(collectLiteralWrites(DIRECT_PRISMA_SRC)).toEqual(["specialist.route"]);
    // And prove it is WRITE_DIRECT doing the work, not an accident:
    WRITE_DIRECT.lastIndex = 0;
    expect(WRITE_DIRECT.exec(DIRECT_PRISMA_SRC)?.[1]).toBe("specialist.route");
  });

  it("is not stateful across calls — a /g regex reused without reset skips matches", () => {
    expect(collectLiteralWrites(DIRECT_PRISMA_SRC)).toEqual(["specialist.route"]);
    expect(collectLiteralWrites(DIRECT_PRISMA_SRC)).toEqual(["specialist.route"]);
  });

  it("does not leap across call sites to attribute a distant metric name", () => {
    const far = `prisma.systemMetric.create({ data: {${" ".repeat(400)}metric: "nope" } });`;
    expect(collectLiteralWrites(far)).toEqual([]);
  });
});

describe("isDataReader", () => {
  it("counts a file that queries the table", () => {
    expect(isDataReader(`FROM system_metrics WHERE metric = $1`)).toBe(true);
  });

  it("does not count a file that merely names a lane", () => {
    expect(isDataReader(`const KNOWN = ["tool.chosen", "action.done.shadow"];`)).toBe(false);
  });
});

describe("excludeSelf", () => {
  it("drops the scanning script from its own candidate list", () => {
    const out = excludeSelf(
      ["lib/observability/tool-usage-census.ts", "scripts/probe-metric-readers.mjs"],
      "scripts/probe-metric-readers.mjs",
    );
    expect(out).toEqual(["lib/observability/tool-usage-census.ts"]);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The walker yields OS-native separators. On Windows the candidate arrives
  // as `scripts\probe-metric-readers.mjs` while SELF_REL is written with
  // forward slashes — a naive === comparison silently re-admits the probe and
  // restores the exact defect. CI runs Linux, so only this test catches it.
  it("CANARY — excludes the self path spelled with Windows separators", () => {
    const out = excludeSelf(
      ["scripts\\probe-metric-readers.mjs"],
      "scripts/probe-metric-readers.mjs",
    );
    expect(out).toEqual([]);
  });
});

/**
 * BEHAVIOURAL CANARY — the known orphans must stay detected.
 *
 * Reconstructs the probe's decision for a lane whose ONLY candidate reader is
 * the probe itself. That is the real shape of `action.done.shadow` and
 * `operation.integrity_shadow`, and before the fix it produced "has a reader".
 */
describe("orphan detection", () => {
  const classify = (candidates: string[], codeFor: Record<string, string>) =>
    excludeSelf(candidates, "scripts/probe-metric-readers.mjs").filter((c) =>
      isDataReader(codeFor[c] ?? ""),
    );

  it("CANARY — a lane read only by the probe itself is still an ORPHAN", () => {
    const readers = classify(["scripts\\probe-metric-readers.mjs"], {
      "scripts\\probe-metric-readers.mjs": `/system_metrics|systemMetric\\b/`,
    });
    expect(readers).toEqual([]);
  });

  it("still reports a genuine reader", () => {
    const readers = classify(
      ["lib/observability/tool-usage-census.ts", "scripts\\probe-metric-readers.mjs"],
      {
        "lib/observability/tool-usage-census.ts": `SELECT * FROM system_metrics`,
        "scripts\\probe-metric-readers.mjs": `/system_metrics|systemMetric\\b/`,
      },
    );
    expect(readers).toEqual(["lib/observability/tool-usage-census.ts"]);
  });
});
