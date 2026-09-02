/**
 * Router degradation canaries · 2026-09-02
 *
 * Three /brain readings used to swallow read failures into a shape that was
 * indistinguishable from "nothing to report":
 *
 *   · brain.calibrationSummary  -> { resolved: 0, verdict: "unknown" }
 *   · brain.identityDelta       -> null
 *   · journal.learningVelocity  -> null
 *
 * Each consuming tile hides itself on exactly that value, so a broken Prisma
 * read rendered as a clean, healthy dashboard. These assert the swallows stay
 * gone.
 *
 * Comments are stripped before every assertion, and that is not a formality
 * here: the fixed brain.ts documents the removed code by quoting it -- the
 * identityDelta docstring contains the literal words `catch { return null }`.
 * Searching the raw file for "catch" finds that sentence and passes while the
 * swallow is back in the code. The stripping guard below fails loudly if that
 * ever stops being true.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const brainRaw = readFileSync(path.join(ROOT, "lib/trpc/routers/brain.ts"), "utf8");
const journalRaw = readFileSync(path.join(ROOT, "lib/trpc/routers/journal.ts"), "utf8");
const brain = strip(brainRaw);
const journal = strip(journalRaw);

/**
 * Source of ONE procedure: from its name to the start of the next procedure
 * declaration. A fixed-width slice bled into the following procedure, so a
 * swallow restored in `calibrationSummary` also failed `identityDelta`'s
 * assertion — a canary that fires for a neighbour's defect is not pointing at
 * anything.
 */
function procedure(source: string, name: string): string {
  const start = source.indexOf(`${name}: operatorProcedure`);
  expect(start, `procedure ${name} not found`).toBeGreaterThan(-1);
  const rest = source.slice(start + name.length);
  const next = rest.search(/\n {2}[A-Za-z_$][\w$]*: operatorProcedure/);
  return next === -1 ? source.slice(start) : source.slice(start, start + name.length + next);
}

describe("comment stripping", () => {
  it("removes the docstring that quotes the removed swallow", () => {
    // Guards the guard. brain.ts explains the fix by naming the old code.
    expect(brainRaw).toContain("catch { return null }");
    expect(brain).not.toContain("catch { return null }");
  });
});

describe("brain.calibrationSummary", () => {
  const body = () => procedure(brain, "calibrationSummary");

  it("does not catch the read failure", () => {
    expect(body()).not.toContain("catch");
  });

  it("does not fabricate an empty calibration result", () => {
    // The old fallback returned a full, plausible, entirely invented summary.
    expect(body()).not.toContain('verdict: "unknown" as const');
    expect(body()).not.toContain("resolved: 0");
  });

  it("delegates straight to the helper", () => {
    expect(body()).toContain("summarizeCalibration({ days: input?.days ?? 30 })");
  });
});

describe("brain.identityDelta", () => {
  const body = () => procedure(brain, "identityDelta");

  it("does not catch the read failure", () => {
    expect(body()).not.toContain("catch");
  });

  it("still returns null for a genuinely absent delta", () => {
    // null must mean one thing only: there is no delta to show.
    expect(body()).toContain("return null;");
    expect(body()).toContain("row.deltaFromLast.trim().length === 0");
  });
});

describe("journal.learningVelocity", () => {
  const body = () => procedure(journal, "learningVelocity");

  it("rethrows a helper failure instead of reporting an empty digest", () => {
    // This digest always returns numbers -- it has no empty state -- so the
    // old `return null` could only ever have meant failure, and the
    // scoreboard hid itself on it.
    expect(body()).toContain("throw err;");
    expect(body()).not.toContain("return null;");
  });

  it("still logs before the failure leaves the procedure", () => {
    expect(body()).toContain('log.warn("learning_velocity_failed"');
  });

  it("maps only window-qualified fields", () => {
    const b = body();
    expect(b).toContain("memoryPctChange30d");
    expect(b).toContain("contradictionsResolved30d");
    expect(b).toContain("wisdomCreated30d");
    expect(b).toContain("newConnections30d");
    expect(b).toContain("healthScoreMax");
    // The deleted composite and the lifetime running total.
    expect(b).not.toContain("overallGrowth");
    expect(b).not.toMatch(/contradictionsResolved:/);
  });
});

describe("learning-velocity helper", () => {
  const helper = strip(
    readFileSync(path.join(ROOT, "lib/brain/learning-velocity.ts"), "utf8"),
  );

  it("keeps the snapshot write out of the measure path", () => {
    const measureStart = helper.indexOf("export async function measureLearningVelocity");
    const snapshotStart = helper.indexOf("export async function snapshotLearningVelocity");
    expect(measureStart).toBeGreaterThan(-1);
    expect(snapshotStart).toBeGreaterThan(measureStart);
    const measureBody = helper.slice(measureStart, snapshotStart);
    expect(measureBody).not.toContain("upsert");
  });

  it("does not silently discard a failed snapshot write", () => {
    const snapshot = helper.slice(
      helper.indexOf("export async function snapshotLearningVelocity"),
    );
    expect(snapshot).toContain("upsert");
    expect(snapshot).not.toContain("catch(() => {})");
    expect(snapshot).toContain("log.error");
  });
});

describe("cron owns the snapshot", () => {
  const cron = strip(
    readFileSync(path.join(ROOT, "app/api/cron/intelligence/route.ts"), "utf8"),
  );

  it("calls the snapshot function, not the pure read", () => {
    expect(cron).toContain("snapshotLearningVelocity");
    expect(cron).not.toMatch(/measureLearningVelocity/);
  });
});
