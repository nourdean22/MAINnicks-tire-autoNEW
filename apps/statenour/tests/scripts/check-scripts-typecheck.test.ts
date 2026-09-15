/**
 * check:scripts ratchet — 2026-09-15.
 *
 * The gate exists because `scripts/` is excluded from every tsconfig the
 * verify chain runs, so a script can carry a dead import for months and
 * only fail on the day someone runs it. These tests break the gate first
 * (a regression MUST fail), then prove the happy paths; only the pure
 * parse/compare functions are exercised — main() spawns tsc and is covered
 * by running the gate itself.
 */
import { describe, expect, it } from "vitest";
import {
  compareToBaseline,
  countByFile,
  parseTscOutput,
  toBaseline,
  type Baseline,
  type TscError,
  type Verdict,
} from "@/scripts/check-scripts-typecheck";

const regression = (v: Verdict): Verdict["regressions"] => v.regressions;
const extra: TscError = { file: "scripts/run-data-cleanup.ts", line: 99, code: "TS2322", message: "x" };

const OUTPUT = [
  "scripts/run-data-cleanup.ts(12,5): error TS2339: Property 'x' does not exist on type 'Y'.",
  "scripts/run-data-cleanup.ts(40,9): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
  "scripts\\smoke-7day-wave.ts(30,37): error TS2307: Cannot find module '@/components/chat/mode-persona-chip' or its corresponding type declarations.",
  "some unrelated pnpm chatter line",
  "scripts/lint-baseline.ts(59,39): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.",
].join("\r\n");

describe("parseTscOutput", () => {
  it("parses `tsc --pretty false` lines, normalises Windows separators, ignores chatter", () => {
    const errs = parseTscOutput(OUTPUT);
    expect(errs).toHaveLength(4);
    expect(errs[2]).toEqual({
      file: "scripts/smoke-7day-wave.ts",
      line: 30,
      code: "TS2307",
      message: "Cannot find module '@/components/chat/mode-persona-chip' or its corresponding type declarations.",
    });
    expect(countByFile(errs)).toEqual({ "scripts/run-data-cleanup.ts": 2, "scripts/smoke-7day-wave.ts": 1, "scripts/lint-baseline.ts": 1 });
  });

  it("an empty tsc run (no errors) parses to nothing", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("\n\n")).toEqual([]);
  });
});

describe("compareToBaseline — the ratchet", () => {
  const errs = parseTscOutput(OUTPUT);
  const baseline: Baseline = toBaseline(errs, new Date("2026-09-15T00:00:00Z"));

  it("POSITIVE CONTROL: one more error in a known file FAILS the gate, naming the file", () => {
    const worse = [...errs, extra];
    const v = compareToBaseline(worse, baseline);
    expect(v.ok).toBe(false);
    expect(regression(v)).toEqual([{ file: "scripts/run-data-cleanup.ts", allowed: 2, actual: 3 }]);
  });

  it("POSITIVE CONTROL: a new file with errors FAILS the gate", () => {
    const withNew = [...errs, { file: "scripts/brand-new.ts", line: 1, code: "TS2339", message: "x" }];
    const v = compareToBaseline(withNew, baseline);
    expect(v.ok).toBe(false);
    expect(v.newFiles).toEqual([{ file: "scripts/brand-new.ts", actual: 1 }]);
  });

  it("the same errors as the baseline pass", () => {
    const v = compareToBaseline(errs, baseline);
    expect(v.ok).toBe(true);
    expect(v.total).toBe(4);
    expect(v.regressions).toEqual([]);
    expect(v.newFiles).toEqual([]);
    expect(v.improvements).toEqual([]);
  });

  it("fewer errors pass and are reported as improvements (including a file that went to zero)", () => {
    const better = errs.filter((e) => e.file !== "scripts/lint-baseline.ts" && e.line !== 40);
    const v = compareToBaseline(better, baseline);
    expect(v.ok).toBe(true);
    expect(v.improvements).toEqual(
      expect.arrayContaining([
        { file: "scripts/run-data-cleanup.ts", allowed: 2, actual: 1 },
        { file: "scripts/lint-baseline.ts", allowed: 1, actual: 0 },
      ]),
    );
  });

  it("dead imports (TS2307) are surfaced as a finding on every run, even when within baseline", () => {
    const v = compareToBaseline(errs, baseline);
    expect(v.deadImports.map((d) => d.file)).toEqual(["scripts/smoke-7day-wave.ts"]);
  });

  it("with no baseline at all, any error is new — the first run must be a snapshot", () => {
    const v = compareToBaseline(errs, null);
    expect(v.ok).toBe(false);
    expect(v.newFiles).toHaveLength(3);
    expect(compareToBaseline([], null).ok).toBe(true);
  });
});
