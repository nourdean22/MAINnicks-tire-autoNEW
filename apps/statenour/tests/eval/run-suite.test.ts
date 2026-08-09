/**
 * tests/eval/run-suite.test.ts · Contract test for the Nick eval suite.
 *
 * This test is INTENTIONALLY hermetic — it never calls Nick or any
 * LLM judge. It validates:
 *
 *   1. Every JSON file under tests/eval/scenarios/ conforms to the
 *      `Scenario` Zod schema. Catches typos, missing fields, bad
 *      category enums before they bite an operator running --live.
 *   2. Dry-run mode loads + counts scenarios without erroring.
 *   3. The summary-line formatter produces a sensible string.
 *
 * Live-mode coverage lives in operator-run smoke (pnpm eval:live).
 * That's by design · we never want CI burning provider credits on
 * every PR. The "did anything visible break?" guarantee used to come
 * from lib/eval/regression-runner.ts, deleted 2026-08-09 as dead code.
 */
import { describe, expect, it } from "vitest";

import {
  formatSummaryLine,
  loadScenarios,
  runDryRun,
} from "./run-suite";
import { scenarioCategoryValues, scenarioSchema } from "./types";

describe("eval suite · scenario JSON contract", () => {
  it("every scenario file conforms to the Scenario schema", async () => {
    const { scenarios, invalid } = await loadScenarios();
    // Verbose error · listing every failure so operator can fix all in one pass.
    expect(invalid, `${invalid.length} scenario(s) failed schema`).toEqual([]);
    expect(scenarios.length, "expected ≥1 scenario").toBeGreaterThanOrEqual(1);
  });

  it("scenarios cover ≥5 distinct categories (suite breadth check)", async () => {
    const { scenarios } = await loadScenarios();
    const categories = new Set(scenarios.map((s) => s.category));
    expect(categories.size, "suite should cover ≥5 categories").toBeGreaterThanOrEqual(5);
    // Every category present must be in the canonical list.
    for (const c of categories) {
      expect(scenarioCategoryValues, `unknown category: ${c}`).toContain(c);
    }
  });

  it("scenario ids are unique across the suite", async () => {
    const { scenarios } = await loadScenarios();
    const ids = scenarios.map((s) => s.id);
    const dedup = new Set(ids);
    expect(dedup.size, "duplicate scenario ids").toBe(ids.length);
  });
});

describe("Scenario schema · representative cases", () => {
  it("accepts a minimal valid scenario", () => {
    const parsed = scenarioSchema.safeParse({
      id: "test-min",
      name: "Minimum viable scenario",
      description: "Just enough fields to pass validation.",
      category: "edge",
      input: { messages: [{ role: "user", content: "hi" }] },
      judgeCriteria: [{ id: "is-short", description: "reply is short", weight: 1.0 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects id with uppercase", () => {
    const parsed = scenarioSchema.safeParse({
      id: "BAD_ID",
      name: "x",
      description: "x",
      category: "edge",
      input: { messages: [{ role: "user", content: "hi" }] },
      judgeCriteria: [{ id: "c", description: "d", weight: 1.0 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty input.messages", () => {
    const parsed = scenarioSchema.safeParse({
      id: "no-messages",
      name: "x",
      description: "x",
      category: "edge",
      input: { messages: [] },
      judgeCriteria: [{ id: "c", description: "d", weight: 1.0 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty judgeCriteria", () => {
    const parsed = scenarioSchema.safeParse({
      id: "no-criteria",
      name: "x",
      description: "x",
      category: "edge",
      input: { messages: [{ role: "user", content: "hi" }] },
      judgeCriteria: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown category", () => {
    const parsed = scenarioSchema.safeParse({
      id: "bad-cat",
      name: "x",
      description: "x",
      category: "made-up",
      input: { messages: [{ role: "user", content: "hi" }] },
      judgeCriteria: [{ id: "c", description: "d", weight: 1.0 }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("runDryRun", () => {
  it("returns a SuiteReport with mode='dry-run' and no results", async () => {
    const report = await runDryRun({ args: { live: false, filter: null, outPath: null } });
    expect(report.mode).toBe("dry-run");
    expect(report.results).toEqual([]);
    expect(report.summary.ranScenarios).toBe(0);
    expect(report.summary.totalScenarios).toBeGreaterThanOrEqual(1);
    expect(report.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("respects category filter", async () => {
    const report = await runDryRun({ args: { live: false, filter: "decision", outPath: null } });
    expect(report.filter).toBe("decision");
    // ≥1 decision scenario should exist
    expect(report.summary.totalScenarios).toBeGreaterThanOrEqual(1);
  });
});

describe("formatSummaryLine", () => {
  it("produces a readable line for dry-run mode", () => {
    const line = formatSummaryLine({
      ranAt: "2026-05-23T12:00:00.000Z",
      mode: "dry-run",
      filter: null,
      results: [],
      summary: { totalScenarios: 7, ranScenarios: 0, passing: 0, flagged: 0, errored: 0, meanComposite: 0 },
      durationMs: 12,
    });
    expect(line).toContain("dry-run");
    expect(line).toContain("7 scenario");
    expect(line).toContain("12ms");
  });

  it("produces a readable line for live mode", () => {
    const line = formatSummaryLine({
      ranAt: "2026-05-23T12:00:00.000Z",
      mode: "live",
      filter: null,
      results: [],
      summary: {
        totalScenarios: 7,
        ranScenarios: 7,
        passing: 5,
        flagged: 1,
        errored: 1,
        meanComposite: 7.4,
      },
      durationMs: 18_400,
    });
    expect(line).toContain("live");
    expect(line).toContain("7/7");
    expect(line).toContain("5 passing");
    expect(line).toContain("1 flagged");
    expect(line).toContain("mean 7.4/10");
  });
});
