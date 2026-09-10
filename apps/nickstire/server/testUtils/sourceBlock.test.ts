/**
 * The helper's whole value is that it FAILS where a raw slice silently widened,
 * so the negative cases are the real tests here — a suite that only proved
 * "it slices correctly" would pass just as well against the bug it replaces.
 */
import { describe, expect, it } from "vitest";
import { sliceBlock } from "./sourceBlock";

const SRC = [
  "export function alpha() {",
  "  return 1;",
  "}",
  "export function beta() {",
  "  return 2;",
  "}",
].join("\n");

describe("sliceBlock", () => {
  it("returns exactly the region between the markers", () => {
    const block = sliceBlock(SRC, "export function alpha", "\nexport function beta");
    expect(block).toContain("return 1;");
    expect(block).not.toContain("return 2;");
  });

  it("THROWS when the end marker is absent, instead of widening to EOF", () => {
    // This is the defect being designed out. A raw
    // `SRC.slice(start, SRC.indexOf("NO_SUCH"))` returns nearly the whole
    // string here, and any toContain over it passes on unrelated text.
    expect(() => sliceBlock(SRC, "export function alpha", "\nNO_SUCH_MARKER")).toThrow(
      /no end marker found/,
    );
  });

  it("the raw form it replaces really does widen — the control for the test above", () => {
    // Without this, the throw above could be dismissed as defensive noise.
    // It documents that the alternative is not "empty" or "error" but "more".
    const start = SRC.indexOf("export function alpha");
    // fail-open-slice-ok: this IS the defect, demonstrated on purpose.
    const widened = SRC.slice(start, SRC.indexOf("\nNO_SUCH_MARKER"));
    expect(widened).toContain("return 2;");
  });

  it("THROWS when the start marker is absent", () => {
    expect(() => sliceBlock(SRC, "export function missing", "\nexport function beta")).toThrow(
      /start marker not found/,
    );
  });

  it("takes the EARLIEST of several candidate end markers", () => {
    // Passing alternatives must narrow the block, never widen it — otherwise a
    // caller adding a fallback marker would silently loosen their own bound.
    const block = sliceBlock(SRC, "export function alpha", ["\nexport function beta", "\n}"]);
    expect(block).not.toContain("return 2;");
    expect(block).not.toContain("}");
  });

  it("searches for the end marker AFTER the start text, so it cannot self-match", () => {
    const block = sliceBlock(SRC, "export function alpha", "export function");
    expect(block).toContain("return 1;");
    expect(block).not.toContain("return 2;");
  });

  it("runs to end of source only when explicitly asked", () => {
    const block = sliceBlock(SRC, "export function beta", "\nNO_SUCH_MARKER", {
      toEndOfSource: true,
    });
    expect(block).toContain("return 2;");
    expect(block).not.toContain("return 1;");
  });

  it("names the missing marker and the label in the error", () => {
    // A guard whose failure does not say what to fix gets worked around.
    expect(() => sliceBlock(SRC, "export function alpha", "\nZZZ", { label: "revenue.ts" })).toThrow(
      /revenue\.ts.*ZZZ|ZZZ.*revenue\.ts/s,
    );
  });
});
