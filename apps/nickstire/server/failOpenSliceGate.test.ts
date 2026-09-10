/**
 * The class gate: no NEW fail-open source slices.
 *
 * THE DEFECT CLASS. A test that locates a region of source by `indexOf` anchors
 *
 *     const body = src.slice(start, src.indexOf("export function next"));
 *
 * silently WIDENS when the anchor is gone: `indexOf` returns -1, and
 * `String.slice` reads a negative `end` as an offset from the end of the
 * string, so the region runs to one character before EOF. A `toContain` over
 * that region then passes on text from somewhere else, and the test reports
 * green while asserting nothing about its subject. Nothing throws, nothing
 * warns, and the failure is invisible in the pass line.
 *
 * WHY A BASELINE RATHER THAN A SWEEP. Measured 2026-09-10 with a runtime
 * detector (String.prototype.slice instrumented across a 43-file, 660-test
 * run): of the sites present then, exactly ONE was actually reaching a -1 —
 * marginCoverageGuard.test.ts, which bounded a slice with `indexOf("\n// ")`
 * against a source it had just run through stripComments(), so the anchor could
 * never match. Every other site's anchor was present. Converting them wholesale
 * would be churn against working tests in files this change does not otherwise
 * touch, and each rewrite is a chance to break a test nobody re-derived.
 *
 * So: fix the one that was broken, make the safe construction available
 * (server/testUtils/sourceBlock.ts), and stop the class GROWING. The remaining
 * sites are debt to pay down as each file is next edited, not a mandate to
 * rewrite 47 files blind.
 *
 * Counts, not line numbers: line numbers churn on every unrelated edit, and a
 * gate that cries wolf gets deleted. A count going UP fails; a count going DOWN
 * is a conversion, and `node scripts/update-fail-open-slice-baseline.mjs`
 * records it (that script refuses to raise a count, so the baseline is a
 * ratchet rather than a rubber stamp).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  FAIL_OPEN,
  OPT_OUT,
  isCommentLine,
  isOptedOut,
  scanFailOpenSlices,
} from "../scripts/lib/failOpenSliceScan.mjs";

const APP = process.cwd();
const BASELINE_PATH = "config/fail-open-slice-baseline.json";

const baseline: Record<string, number> = JSON.parse(
  readFileSync(resolve(APP, BASELINE_PATH), "utf8"),
);
const current: Record<string, number> = scanFailOpenSlices(APP);

describe("fail-open source slices do not grow", () => {
  it("the scanner actually finds sites — the canary", () => {
    // A regex that silently matched nothing would make every check below
    // vacuously pass, which is the exact failure mode this gate is about.
    expect(Object.keys(current).length).toBeGreaterThan(10);
    expect(Object.keys(baseline).length).toBeGreaterThan(10);
  });

  it("the scanner honours the inline opt-out", () => {
    // server/testUtils/sourceBlock.test.ts contains a deliberate raw slice that
    // demonstrates the defect. If the opt-out ever stops working, that file
    // shows up as an offender and the gate starts lying about its own subject.
    const lines = readFileSync(
      resolve(APP, "server/testUtils/sourceBlock.test.ts"),
      "utf8",
    ).split("\n");
    const optedOut = lines.filter((l, i) => FAIL_OPEN.test(l) && isOptedOut(lines, i));
    expect(optedOut.length, "the opt-out fixture is gone").toBeGreaterThan(0);
    expect(current["server/testUtils/sourceBlock.test.ts"] ?? 0).toBe(0);
  });

  it("a comment MENTIONING the pattern is not counted, but real code is", () => {
    // Locked as a permanent allow/deny pair after this gate blocked its own
    // scanner on its first run: the doc-comment at the top of
    // scripts/lib/failOpenSliceScan.mjs quotes the pattern it looks for.
    // guard-red-team names mention-vs-execution as the largest source of guard
    // false positives, and this repo has been bitten by it four times — a check
    // that fails on its own documentation gets deleted by the next reader.
    const counted = (line: string) => FAIL_OPEN.test(line) && !isCommentLine(line);

    // These fixtures are string literals sitting on CODE lines, so the scanner
    // counts them unless each opts out — which it did, on the first run, by
    // reporting this very file. Marked per line rather than adding a file-level
    // escape hatch: a whole-file exemption is a tool someone would eventually
    // reach for to silence a real finding.
    const jsdoc = ' * src.slice(start, src.indexOf("x")) is the defect'; // fail-open-slice-ok
    const lineComment = '  // const y = a.slice(0, a.indexOf("b"));'; // fail-open-slice-ok
    const blockComment = '  /* a.slice(0, a.indexOf("b")) */'; // fail-open-slice-ok
    const realCode = '  const real = a.slice(0, a.indexOf("b"));'; // fail-open-slice-ok

    expect(counted(jsdoc), "jsdoc").toBe(false);
    expect(counted(lineComment), "line comment").toBe(false);
    expect(counted(blockComment), "block comment").toBe(false);

    // The deny half. Without it, a scanner that counted nothing at all would
    // satisfy every assertion above.
    expect(counted(realCode), "real code").toBe(true);
  });

  it("no file introduces a NEW fail-open slice", () => {
    const offenders: string[] = [];
    for (const [file, n] of Object.entries(current)) {
      const allowed = baseline[file] ?? 0;
      if (n > allowed) offenders.push(`${file}: ${n} (baseline ${allowed})`);
    }
    expect(
      offenders,
      "New fail-open slice(s). A missing indexOf anchor silently widens the region to EOF, " +
        "and the assertion then passes on unrelated text. Use sliceBlock() from " +
        "server/testUtils/sourceBlock.ts, which throws instead — or put a " +
        `'${OPT_OUT}' comment on or above the line if the raw form is genuinely intended.\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the baseline has no stale entries for files that no longer exist", () => {
    // Otherwise the baseline slowly becomes a licence for files it no longer
    // describes, and a re-added path inherits an allowance nobody granted.
    const missing = Object.keys(baseline).filter((f) => {
      try {
        statSync(resolve(APP, f));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing, `baseline lists files that no longer exist: ${missing.join(", ")}`).toEqual([]);
  });
});
