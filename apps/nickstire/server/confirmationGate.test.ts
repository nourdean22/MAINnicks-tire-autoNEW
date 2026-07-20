/**
 * A confirmation gate must compare what the operator SEES.
 *
 * The Win-Back safety gate's input carries the CSS class `uppercase`. That is
 * `text-transform` — purely visual. `e.target.value` is still exactly what was
 * typed. So typing "confirm" DISPLAYS "CONFIRM" while the state holds "confirm",
 * the strict `=== "CONFIRM"` fails, and ACTIVATE CAMPAIGN stays disabled with all
 * three checkboxes green and the word CONFIRM plainly visible in the field.
 *
 * Reported live 2026-07-20 with a screenshot: every check ticked, CONFIRM in the
 * box, button dead. The screen was showing a value it was not holding, and
 * nothing on it could reveal the difference — the operator had no way to debug
 * their own correct input.
 *
 * This gate guards ~267 real outbound texts, so it is exactly the control that
 * must not fail closed for an invisible reason.
 */
import { describe, it, expect } from "vitest";
import { readCode, readSource } from "./testUtils/sourceAssertions";

const src = readSource("client/src/pages/admin/outreach/WinBackSection.tsx");
// NEGATIVE assertions run on code — the docblock quotes the old predicate.
const code = readCode("client/src/pages/admin/outreach/WinBackSection.tsx");

/** The gate's own predicate, mirrored so the cases below are executable. */
const canExecute = (checks: boolean, typed: string) =>
  checks && typed.trim().toUpperCase() === "CONFIRM";

describe("the typed confirmation matches the rendered text", () => {
  it.each([
    ["CONFIRM", "exactly as displayed"],
    ["confirm", "lowercase — what CSS uppercase hides"],
    ["Confirm", "phone autocapitalise"],
    ["  CONFIRM  ", "leading/trailing space from a keyboard"],
    ["confirm ", "trailing space from autocomplete"],
  ])("accepts %j (%s)", (typed) => {
    expect(canExecute(true, typed)).toBe(true);
  });

  it.each(["", "   ", "CONFIR", "CONFIRMED", "yes", "OK"])("still refuses %j", (typed) => {
    // The gate must remain a real act of intent, not a formality.
    expect(canExecute(true, typed)).toBe(false);
  });

  it("still requires every checkbox regardless of the text", () => {
    expect(canExecute(false, "CONFIRM")).toBe(false);
  });
});

describe("the shipped predicate is the one tested here", () => {
  it("normalises case and whitespace before comparing", () => {
    expect(src).toMatch(/confirmText\.trim\(\)\.toUpperCase\(\) === "CONFIRM"/);
  });

  it("no longer compares the raw value against an uppercase literal", () => {
    // The exact defect: a strict compare against text the CSS was rewriting.
    expect(code).not.toMatch(/confirmText === "CONFIRM"/);
  });

  it("keeps all three checkboxes in the predicate", () => {
    expect(src).toMatch(/check1 && check2 && check3 &&/);
  });
});
