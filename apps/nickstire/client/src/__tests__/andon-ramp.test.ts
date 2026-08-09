import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The andon ramp exists because Tailwind's palette is perceptually uniform
 * WITHIN a hue and not ACROSS hues: red-400 ships at L 70.4%, emerald-400 at
 * 76.5%, amber-400 at 82.8%. One nominal step, a 12.4-point lightness spread,
 * running backwards — amber brightest, red dimmest. On an andon board that
 * makes "stop" the quietest colour on the screen.
 *
 * index.css re-tints the three signal hues to one lightness per tier. These
 * tests assert the MECHANISM rather than the literal values: the tier stays
 * equal-lightness, and every colour stays inside its hue's sRGB gamut so the
 * browser never clamps it (clamping shifts lightness, which would silently
 * restore the drift the block removes).
 */

const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");

const ANDON_BLOCK = (() => {
  const start = CSS.indexOf(".admin-shell {");
  expect(start, "the .admin-shell andon block must exist").toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("}", start));
})();

type Token = { name: string; L: number; C: number; H: number };

function parseTokens(block: string): Token[] {
  const re = /--color-(red|amber|emerald)-(\d{3}):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g;
  const out: Token[] = [];
  for (const m of block.matchAll(re)) {
    out.push({ name: `${m[1]}-${m[2]}`, L: Number(m[3]), C: Number(m[4]), H: Number(m[5]) });
  }
  return out;
}

/** OKLCH -> linear sRGB (Ottosson). In gamut when every channel lands in [0,1]. */
function inGamut(L: number, C: number, H: number): boolean {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

const tokens = parseTokens(ANDON_BLOCK);

describe("andon ramp", () => {
  it("canary: the block defines all three hues at all three tiers", () => {
    expect(tokens).toHaveLength(9);
    for (const tier of ["300", "400", "500"]) {
      const names = tokens.filter((t) => t.name.endsWith(tier)).map((t) => t.name).sort();
      expect(names).toEqual([`amber-${tier}`, `emerald-${tier}`, `red-${tier}`]);
    }
  });

  it.each(["300", "400", "500"])(
    "tier %s is equal-lightness across red, amber and emerald",
    (tier) => {
      const ls = tokens.filter((t) => t.name.endsWith(tier)).map((t) => t.L);
      expect(new Set(ls).size, `tier ${tier} lightness values: ${ls.join(", ")}`).toBe(1);
    },
  );

  it("tiers descend in lightness, soft -> text -> fill", () => {
    const at = (tier: string) => tokens.find((t) => t.name.endsWith(tier))!.L;
    expect(at("300")).toBeGreaterThan(at("400"));
    expect(at("400")).toBeGreaterThan(at("500"));
  });

  it("every colour is inside sRGB, so the browser cannot clamp it", () => {
    const clamped = tokens.filter((t) => !inGamut(t.L, t.C, t.H)).map((t) => t.name);
    expect(clamped).toEqual([]);
  });

  it("red keeps the most chroma at the text tier — severity leads on saturation", () => {
    const tier = tokens.filter((t) => t.name.endsWith("400"));
    const red = tier.find((t) => t.name.startsWith("red"))!;
    for (const other of tier.filter((t) => !t.name.startsWith("red"))) {
      expect(red.C).toBeGreaterThan(other.C);
    }
  });

  it("money columns in admin tables use tabular figures", () => {
    expect(CSS).toMatch(/\.admin-shell :is\(table, th, td\) \{\s*font-variant-numeric: tabular-nums;/);
  });
});
