/**
 * tests/brain/display-label.test.ts · 2026-09-02 · WP-1.
 *
 * The label derivation is pure string work, so it is testable exactly — and it
 * must be, because it decides what the operator can read on the map. The
 * production payload measured 2026-09-02 had P90 label length 98 and a 297-char
 * maximum; the canvas previously hard-sliced at 34 chars mid-word.
 *
 * Idempotency is the load-bearing property: the shaping layer may run over
 * already-shaped text, and a label that shrinks each pass would drift.
 */
import { describe, expect, it } from "vitest";
import { DISPLAY_LABEL_MAX, displayLabel } from "@/lib/brain/display-label";

describe("displayLabel · delimiter cuts", () => {
  it("cuts at an em dash", () => {
    expect(displayLabel("Adderall pattern — mandatory decision required")).toBe("Adderall pattern");
  });

  it("cuts at an en dash (the real production shape)", () => {
    expect(
      displayLabel("Create recurring Monday task 7:30-8:00 AM – Prep: email and inventory glance (Personal OS / Inbox)"),
      // "7:30-8" would be cut mid-token, so the word-boundary rule drops it.
    ).toBe("Recurring Monday task…");
  });

  it("cuts at a colon", () => {
    expect(displayLabel("Fertility: the next appointment window")).toBe("Fertility");
  });

  it("cuts at a parenthetical", () => {
    expect(displayLabel("Inventory glance (Personal OS / Inbox)")).toBe("Inventory glance");
  });

  it("cuts at a comma", () => {
    expect(displayLabel("Heavy bag workout, ten two-minute rounds")).toBe("Heavy bag workout");
  });

  it("takes the FIRST delimiter when several are present", () => {
    expect(displayLabel("Alpha: beta — gamma, delta")).toBe("Alpha");
  });

  it("leaves a hyphenated word alone — only a spaced dash is a delimiter", () => {
    expect(displayLabel("Follow-up cadence")).toBe("Follow-up cadence");
  });
});

describe("displayLabel · leading verbs", () => {
  it("strips an allowlisted verb and recapitalises", () => {
    expect(displayLabel("Review the quarterly inventory position")).toBe("The quarterly inventory…");
  });

  it("REFUSES the strip when the remainder would be too short", () => {
    // "Fix bug" -> "bug" is less informative than the original.
    expect(displayLabel("Fix bug")).toBe("Fix bug");
    expect(displayLabel("Call Nick")).toBe("Call Nick");
  });

  it("does not strip a word that merely starts with a verb", () => {
    expect(displayLabel("Updated pricing model rollout")).toBe("Updated pricing model…");
  });

  it("does not strip a non-allowlisted leading word", () => {
    expect(displayLabel("Consider the supplier margin question")).toBe("Consider the supplier…");
  });
});

describe("displayLabel · truncation", () => {
  it("never exceeds the max", () => {
    const long = "I took my 30mg Zepbound at 6am and had two double shot americanos with vanilla fairlife";
    expect(displayLabel(long).length).toBeLessThanOrEqual(DISPLAY_LABEL_MAX);
  });

  it("truncates on a word boundary, never mid-word", () => {
    const out = displayLabel("Supplier margin reconciliation across every location");
    expect(out.endsWith("…")).toBe(true);
    // the character before the ellipsis must not be a partial word cut mid-letter-run
    const body = out.slice(0, -1);
    expect(body).toBe(body.trimEnd());
    expect(body.split(" ").every((w) => w.length > 0)).toBe(true);
  });

  it("leaves a short label untouched, with no ellipsis", () => {
    expect(displayLabel("NOUR OS")).toBe("NOUR OS");
    expect(displayLabel("Nick's Tire")).toBe("Nick's Tire");
  });

  it("honours a custom max", () => {
    expect(displayLabel("Supplier margin reconciliation", 12).length).toBeLessThanOrEqual(12);
  });
});

describe("displayLabel · degenerate input", () => {
  it("handles empty, whitespace and nullish", () => {
    expect(displayLabel("")).toBe("");
    expect(displayLabel("   ")).toBe("");
    expect(displayLabel(null)).toBe("");
    expect(displayLabel(undefined)).toBe("");
  });

  it("collapses internal whitespace and newlines", () => {
    expect(displayLabel("  Heavy   bag\n\nworkout  ")).toBe("Heavy bag workout");
  });

  it("falls back to the original when the head would be a stub", () => {
    // Cutting at ": " would leave "A" — too short, so the original is used.
    expect(displayLabel("A: the whole point of the thing")).toBe("A: the whole point of the…");
  });

  it("keeps unicode intact", () => {
    expect(displayLabel("Café résumé naïve")).toBe("Café résumé naïve");
    // Script-aware minimum: a 2-char CJK head is a word, not a stub. The
    // spec's flat "< 3 chars" rule would have discarded it.
    expect(displayLabel("目標 — 詳細")).toBe("目標");
  });
});

describe("displayLabel · idempotency (load-bearing)", () => {
  const cases = [
    "Create recurring Monday task 7:30-8:00 AM – Prep: email and inventory glance (Personal OS / Inbox)",
    "Review the quarterly inventory position",
    "Supplier margin reconciliation across every location",
    "NOUR OS",
    "Fix bug",
    "",
    "  spaced   out  ",
    "目標 — 詳細",
    "A: the whole point of the thing",
  ];

  it("f(f(x)) === f(x) for every case", () => {
    for (const c of cases) {
      const once = displayLabel(c);
      expect(displayLabel(once), `not idempotent for: ${JSON.stringify(c)}`).toBe(once);
    }
  });

  it("a label already at the cap survives a second pass unchanged", () => {
    const once = displayLabel("Supplier margin reconciliation across every location");
    expect(once.length).toBeLessThanOrEqual(DISPLAY_LABEL_MAX);
    expect(displayLabel(once)).toBe(once);
  });
});
