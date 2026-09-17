/**
 * Canaries for the metric-lane sweep.
 *
 * WHY THIS FILE EXISTS — the sweep shipped in #2397 reporting
 * "5 metric lanes written · 1 lane nothing reads". Both numbers were wrong, and
 * wrong in the flattering direction. The honest figures are 14 and 8.
 *
 * 1. WRITER DISCOVERY SAW ONE SHAPE — `recordMetric…("name")` only, while a
 *    dozen files write through `prisma.systemMetric.create`.
 * 2. THE PROBE COUNTED ITSELF AS A READER — it scans `scripts/`, so it scans
 *    itself, and its source contains `systemMetric` inside the very regex that
 *    detects readers.
 * 3. NONLITERAL DIRECT WRITES WERE DROPPED, not reported as unresolved.
 *
 * ⚠ AND THE FIRST VERSION OF THIS TEST FILE WAS A MIRROR. It re-implemented
 * classification by calling `excludeSelf` and `isDataReader` side by side and
 * never executed the probe — so deleting the `excludeSelf` call inside
 * `probe-metric-readers.mjs` left every test green while the self-reader bug
 * returned. Review caught it. The suite now drives the exported `runSweep`
 * against a fixture tree, so breaking the real guard turns this red.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSweep } from "../../scripts/probe-metric-readers.mjs";
import {
  collectLiteralWrites,
  collectDirectWrites,
  resolveMetricLiteral,
} from "../../scripts/lib/metric-sweep.mjs";

const SELF = "scripts/probe-metric-readers.mjs";
let root: string;

/**
 * A miniature tree with the exact shapes that matter:
 *  · a lane with a genuine data reader
 *  · a lane whose ONLY mention is the probe itself — the real orphan shape
 *  · a non-literal direct write, which must surface as unresolved
 */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "metric-sweep-"));
  mkdirSync(join(root, "lib"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });

  writeFileSync(join(root, "lib/writer.ts"), `recordMetric("fixture.lane", 1, "count");`);
  writeFileSync(
    join(root, "lib/reader.ts"),
    `const rows = await sql\`SELECT * FROM system_metrics WHERE metric = 'fixture.lane'\`;`,
  );
  writeFileSync(
    join(root, "lib/orphan-writer.ts"),
    `await prisma.systemMetric.create({ data: { metric: "fixture.orphan", value: 1 } });`,
  );
  writeFileSync(
    join(root, "lib/dynamic-writer.ts"),
    "await prisma.systemMetric.create({ data: { metric: `fixture.dyn.${name}`, value: 1 } });",
  );
  // Impersonates the probe: queries the table AND names the orphan lane, which
  // is exactly how the real probe manufactured a reader for its own orphans.
  writeFileSync(
    join(root, SELF),
    `const READS = /system_metrics|systemMetric\\b/;\nconst MUST_SEE = ["fixture.orphan"];`,
  );
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const sweep = (selfRel: string) =>
  runSweep({ root, scanDirs: ["lib", "scripts"], selfRel, mustSee: [], minFiles: 0 });

describe("runSweep — the production path", () => {
  it("finds both write shapes", () => {
    const metrics = sweep(SELF).lanes.map((l) => l.metric);
    expect(metrics).toContain("fixture.lane"); // recordMetric
    expect(metrics).toContain("fixture.orphan"); // prisma.systemMetric.create
  });

  it("reports a genuine data reader", () => {
    const lane = sweep(SELF).lanes.find((l) => l.metric === "fixture.lane");
    expect(lane?.dataReaders.map((p) => p.replace(/\\/g, "/"))).toEqual(["lib/reader.ts"]);
  });

  it("reports a non-literal direct write as UNRESOLVED, not silently dropped", () => {
    const u = sweep(SELF).unresolved.join(" | ");
    expect(u).toMatch(/dynamic-writer/);
    expect(u).toMatch(/non-literal/);
    // And it must NOT have invented a lane named after the template text.
    expect(sweep(SELF).lanes.map((l) => l.metric)).not.toContain("fixture.dyn");
  });

  // ── BEHAVIOURAL CANARY ──────────────────────────────────────────────
  // The orphan's only mention is the probe itself. With self-exclusion the
  // lane is an ORPHAN; without it the probe vouches for itself and the orphan
  // disappears. Both assertions run through runSweep, so deleting or moving
  // the excludeSelf call in the probe fails this test.
  it("CANARY — a lane mentioned only by the probe itself stays an ORPHAN", () => {
    expect(sweep(SELF).orphans).toContain("fixture.orphan");
  });

  it("CANARY — disabling self-exclusion makes that orphan vanish", () => {
    const unguarded = sweep("scripts/not-the-probe.mjs");
    expect(unguarded.orphans).not.toContain("fixture.orphan");
    // Proves the two runs differ ONLY because of self-exclusion.
    expect(sweep(SELF).orphans).toContain("fixture.orphan");
  });

  it("normalises separators, so a Windows-spelled self path still excludes", () => {
    expect(sweep("scripts\\probe-metric-readers.mjs").orphans).toContain("fixture.orphan");
  });
});

describe("runSweep — controls that must refuse to produce a number", () => {
  it("aborts when the tree is too small to be real", () => {
    const r = runSweep({ root, scanDirs: ["lib"], selfRel: SELF, mustSee: [], minFiles: 999 });
    expect(r.abort).toMatch(/not seeing the tree/);
    expect(r.orphans).toEqual([]);
  });

  it("aborts when a known lane is invisible, instead of printing a shorter list", () => {
    const r = runSweep({
      root,
      scanDirs: ["lib", "scripts"],
      selfRel: SELF,
      mustSee: ["a.lane.that.does.not.exist"],
      minFiles: 0,
    });
    expect(r.abort).toMatch(/could not see/);
  });
});

describe("matchers", () => {
  it("resolves a plain literal and refuses an interpolated one", () => {
    expect(resolveMetricLiteral('"a.b"')).toBe("a.b");
    expect(resolveMetricLiteral("`a.b`")).toBe("a.b");
    expect(resolveMetricLiteral("`a.${x}`")).toBeNull();
    expect(resolveMetricLiteral('m.name || "x"')).toBeNull();
  });

  it("separates literal from non-literal direct writes", () => {
    const src =
      'prisma.systemMetric.create({ data: { metric: "lit.one", value: 1 } });\n' +
      "prisma.systemMetric.create({ data: { metric: `dyn.${k}`, value: 1 } });";
    const d = collectDirectWrites(src);
    expect(d.literals).toEqual(["lit.one"]);
    expect(d.nonliteral.length).toBe(1);
  });

  it("is not stateful across calls — a reused /g regex skips matches", () => {
    const src = 'prisma.systemMetric.create({ data: { metric: "s.one" } });';
    expect(collectLiteralWrites(src)).toEqual(["s.one"]);
    expect(collectLiteralWrites(src)).toEqual(["s.one"]);
  });

  it("does not leap across call sites to attribute a distant metric name", () => {
    const far = `prisma.systemMetric.create({ data: {${" ".repeat(400)}metric: "nope" } });`;
    expect(collectLiteralWrites(far)).toEqual([]);
  });
});
