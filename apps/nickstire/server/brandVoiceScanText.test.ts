/**
 * Brand-voice scanner text-blanking tests.
 *
 * These exist because of a regression caught in review on #1140: the staged-diff
 * path called `keepOnlyStringLiterals` once PER LINE, so the interior lines of a
 * multi-line template literal had no opening backtick, were blanked end to end,
 * and any banned phrase added on them passed the pre-commit gate — the one path
 * that actually blocks a commit. The linter now buffers a hunk's added lines and
 * scans them as one block; these pin the property that makes that correct.
 */

import { describe, expect, it } from "vitest";

import { findVoiceViolations } from "../shared/voice";
import { blankClassNames, keepOnlyStringLiterals } from "../scripts/lib/scanText";

describe("keepOnlyStringLiterals", () => {
  it("keeps quoted copy and blanks the logic around it", () => {
    const out = keepOnlyStringLiterals(`const reliable = greet("welcome to the shop");`);
    expect(out).not.toContain("reliable"); // identifier — logic, not copy
    expect(out).toContain("welcome to the shop"); // string — copy
  });

  it("REGRESSION: keeps the interior lines of a multi-line template literal", () => {
    // Scanned as one block, the interior line is inside an open backtick.
    const block = ["const body = `", "  Our friendly staff will call you back.", "`;"].join("\n");
    const out = keepOnlyStringLiterals(block);
    expect(out).toContain("friendly staff");
    expect(findVoiceViolations(out).map((v) => v.ruleId)).toContain("cliche.friendly-staff");
  });

  it("REGRESSION: scanning that same literal line-by-line is what missed it", () => {
    // The old behaviour, kept as a demonstration of WHY the block scan exists.
    // Each call restarts with no open quote, so the interior line is erased.
    const interior = "  Our friendly staff will call you back.";
    expect(keepOnlyStringLiterals(interior).trim()).toBe("");
    expect(findVoiceViolations(keepOnlyStringLiterals(interior))).toEqual([]);
  });

  it("preserves newlines and total length so line numbers survive", () => {
    const block = 'a\nconst s = "hassle-free";\nb';
    const out = keepOnlyStringLiterals(block);
    expect(out).toHaveLength(block.length);
    expect(out.split("\n")).toHaveLength(3);
    // The violation must report line 2, matching the source.
    const hits = findVoiceViolations(out);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it("handles escaped quotes without losing the rest of the string", () => {
    const out = keepOnlyStringLiterals(`const s = "she said \\"top-notch\\" once";`);
    expect(findVoiceViolations(out).map((v) => v.ruleId)).toContain("cliche.top-notch");
  });

  it("does not treat an apostrophe inside a double-quoted string as a quote", () => {
    const out = keepOnlyStringLiterals(`const s = "don't hesitate to call";`);
    expect(findVoiceViolations(out).map((v) => v.ruleId)).toContain("llm.feel-free");
  });
});

describe("blankClassNames", () => {
  it("blanks a className value so a utility class is not read as prose", () => {
    // 53 of the first audit's 110 hits were the class `btn-premium`.
    const jsx = `<a className="btn-premium px-4">See my size</a>`;
    const out = blankClassNames(jsx);
    expect(findVoiceViolations(out)).toEqual([]);
    expect(out).toContain("See my size"); // real copy survives
  });

  it("still catches a banned word in JSX body text", () => {
    const jsx = `<p className="btn-premium">Trusted by Cleveland drivers</p>`;
    expect(findVoiceViolations(blankClassNames(jsx)).map((v) => v.ruleId)).toContain(
      "cliche.trusted",
    );
  });

  it("preserves length so offsets stay valid", () => {
    const jsx = `<a className="btn-premium">x</a>`;
    expect(blankClassNames(jsx)).toHaveLength(jsx.length);
  });
});
