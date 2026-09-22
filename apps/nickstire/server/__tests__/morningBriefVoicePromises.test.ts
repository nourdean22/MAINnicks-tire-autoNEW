/**
 * The morning brief must not report an unmeasured voice-promise backlog as an
 * empty one.
 *
 * THE DEFECT THIS PINS was in the first version of this very feature. The block
 * read `if (vb && vb.created > 0)`, which renders nothing for a failed read, a
 * missing 0102 table AND a genuine zero — three different facts, one silence.
 *
 * It matters more here than the usual instance of this shape:
 *
 *   1. The feature exists so shop commitments cannot be forgotten. A section
 *      that disappears exactly when capture breaks is indistinguishable from
 *      "nobody promised anything", which is the one conclusion it must never
 *      support.
 *   2. promisesBlock is interpolated into the LLM prompt that WRITES the brief.
 *      A silent omission is not just a missing line for Nick to notice — the
 *      model reads it and renders the zero in prose, with the shop's voice.
 *
 * A measured zero rendering nothing is CORRECT and deliberate: it matches the
 * operator-promise line above it, and the brief does not spend attention on
 * empty sections. The distinction being defended is measured-zero vs
 * not-measured, not zero vs non-zero.
 */
import { describe, expect, it } from "vitest";
import { renderVoicePromiseLine } from "../services/promiseLedger";

describe("a non-measurement never renders as zero", () => {
  it("an unreadable backlog says state unknown, not silence", () => {
    const line = renderVoicePromiseLine({ kind: "unreadable" });
    expect(line).not.toBe("");
    expect(line).toMatch(/unknown/i);
    expect(line).toMatch(/NOT zero/i);
  });

  it("a failed read says state unknown, not silence", () => {
    const line = renderVoicePromiseLine({ kind: "error" });
    expect(line).not.toBe("");
    expect(line).toMatch(/unknown/i);
    expect(line).toMatch(/NOT zero/i);
  });

  it("the two non-measurements are DISTINGUISHABLE from each other", () => {
    // Collapsing "the read returned null" into "the read threw" would lose the
    // difference between an un-applied table and a broken query — the first is
    // a migration the operator has not run, the second is a live fault.
    expect(renderVoicePromiseLine({ kind: "unreadable" })).not.toBe(
      renderVoicePromiseLine({ kind: "error" }),
    );
  });
});

describe("a measured zero stays quiet, and a real backlog speaks", () => {
  it("zero captured commitments renders nothing — matching the line above it", () => {
    expect(renderVoicePromiseLine({ kind: "measured", created: 0, open: 0, overdue: 0 })).toBe("");
  });

  it("a real backlog reports the count and the OVERDUE subset", () => {
    const line = renderVoicePromiseLine({ kind: "measured", created: 12, open: 5, overdue: 3 });
    expect(line).toContain("12 callback commitments captured");
    expect(line).toContain("3 OVERDUE");
    expect(line).toContain("5 open");
  });

  it("states plainly that kept is NOT auto-detected, so the count is not a scorecard", () => {
    // Without this sentence the model is handed a bare count of captured
    // promises next to a kept-rate for operator promises, and the obvious
    // inference — that these were all unkept — is exactly wrong. Unmeasured is
    // not failed.
    const line = renderVoicePromiseLine({ kind: "measured", created: 12, open: 5, overdue: 3 });
    expect(line).toMatch(/kept isn't auto-detected/i);
    expect(line).toMatch(/to-do list, not a scorecard/i);
  });

  it("omits OVERDUE when there are none, rather than printing a zero", () => {
    const line = renderVoicePromiseLine({ kind: "measured", created: 4, open: 4, overdue: 0 });
    expect(line).toContain("4 callback commitments captured");
    expect(line).not.toMatch(/OVERDUE/);
  });
});

describe("POSITIVE CONTROL", () => {
  it("the four states produce four genuinely different renderings", () => {
    // A function that returned "" unconditionally would pass the measured-zero
    // test, and one that returned a constant string would pass both
    // non-measurement tests. This is the assertion that neither can survive.
    const outputs = [
      renderVoicePromiseLine({ kind: "unreadable" }),
      renderVoicePromiseLine({ kind: "error" }),
      renderVoicePromiseLine({ kind: "measured", created: 0, open: 0, overdue: 0 }),
      renderVoicePromiseLine({ kind: "measured", created: 12, open: 5, overdue: 3 }),
    ];
    expect(new Set(outputs).size).toBe(4);
  });

  it("the rendered numbers actually come from the input", () => {
    // Guards the hardcoded-string version of this function, which would satisfy
    // every `toContain` above if the fixtures happened to match.
    const line = renderVoicePromiseLine({ kind: "measured", created: 7, open: 2, overdue: 1 });
    expect(line).toContain("7 callback commitments captured");
    expect(line).not.toContain("12");
  });
});
