/**
 * EmptyState's honesty signals must be readable (audit 2026-10-10 · 09-F6).
 *
 * THE DEFECT. The provenance chip (11px), the SUPPRESSED line and the unlock
 * line were tinted with alpha (`text-[var(--text-tertiary)]/70`, `/50`, `/80`,
 * `text-red-400/80`). Measured: ZERO 3.28:1, ERROR ~4.0, SUPPRESSED 2.19,
 * unlock 3.97. The words that say "this is unknown, not zero" were the
 * least readable text on the panel (WCAG 1.4.3 needs 4.5:1 at 11px).
 *
 * The fix is full-strength theme tokens, no alpha. This pins both halves:
 * the rendered classes carry no alpha, and the token values those classes
 * resolve to (read from app/styles/tokens.css, the source of truth) clear
 * 4.5:1 on canvas, content and interactive surfaces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { EmptyState, type EmptyProvenance } from "@/components/ui/empty-state";

const tokens = readFileSync("app/styles/tokens.css", "utf8");

/** `--name: #RRGGBB` on its own declaration. */
function tokenHex(name: string): string {
  const m = tokens.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\b`));
  if (!m) throw new Error(`token --${name} not found as a hex value`);
  return m[1];
}

/** `--color-x: oklch(...);   /* #RRGGBB ...` (the palette block records the sRGB hex). */
function paletteHex(name: string): string {
  const m = tokens.match(new RegExp(`--color-${name}:[^;]+;\\s*/\\*\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`palette --color-${name} hex comment not found`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["canvas", "surface", "surface-interactive"].map((n) => [n, tokenHex(n)] as const);

const ALL: EmptyProvenance[] = ["ZERO", "UNMEASURED", "ERROR", "SUPPRESSED"];
const render = (p: EmptyProvenance) =>
  renderToStaticMarkup(<EmptyState title="t" provenance={p} why="w" unlock="u" />);

describe("EmptyState honesty signals carry no alpha", () => {
  it("POSITIVE CONTROL: the ratio function reproduces a known pair", () => {
    // #777777 on white is the antislop-human reference row: 4.48.
    expect(ratio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });

  it("no rendered text class is alpha-tinted, in any provenance", () => {
    for (const p of ALL) {
      const classes = [...render(p).matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
      const alphaText = classes.filter((c) => /^text-.*\/\d+$/.test(c));
      expect(alphaText, `${p} renders alpha text: ${alphaText.join(" ")}`).toEqual([]);
    }
  });

  it("the chip and unlock line use the full-strength tokens", () => {
    expect(render("ERROR")).toContain("text-red-300");
    expect(render("ZERO")).toContain("text-fg-tertiary");
    expect(render("SUPPRESSED")).toContain("text-fg-tertiary");
  });
});

describe("the tokens those classes resolve to clear 4.5:1", () => {
  const pairs: [string, string][] = [
    ["text-tertiary", tokenHex("text-tertiary")],
    ["red-300", paletteHex("red-300")],
    ["amber-300", paletteHex("amber-300")],
  ];
  for (const [fg, fgHex] of pairs) {
    for (const [bg, bgHex] of SURFACES) {
      it(`${fg} ${fgHex} on ${bg} ${bgHex}`, () => {
        expect(ratio(fgHex, bgHex)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
