/**
 * 2026-08-09 · Severity tiers must share one lightness, stay in gamut,
 * lead on saturation, and stay clear of brand gold.
 *
 * THE LIVE DEFECT THIS PINS. Tailwind is perceptually uniform WITHIN a
 * hue, not ACROSS hues. Shipped rose-300 L81.0 / sky-300 L82.8 /
 * emerald-300 L84.5 / amber-300 L87.9 ran backwards, so on the /system
 * attention strip (hub-grid.tsx SEVERITY_PALETTE) "critical" was both
 * the dimmest and the least saturated colour on screen. Worse, brand
 * --gold #FDB913 → oklch(0.8271 0.1679 81.30) and stock amber-400
 * oklch(0.828 0.189 84.429) sit at Oklab ΔE 0.0232 — the warning signal
 * and the only brand colour were indistinguishable, on 98 shared surfaces.
 *
 * WHY THE GAMUT ASSERTION EXISTS. An out-of-gamut OKLCH value is
 * CLAMPED by the browser, and clamping shifts lightness — which would
 * silently restore the drift the override removes. A first draft of
 * these values had amber-400 at C 0.150 against a real ceiling of
 * 0.135; that near-miss is the fixture in the guard-the-guard test.
 *
 * These assert the MECHANISM (equal L per tier, in gamut, saturation
 * leads, clear of gold), never the literal hexes — retuning a hue stays
 * free, breaking the invariant is loud.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const D = Math.PI / 180;

function oklabToLinear(L: number, a: number, b: number) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const lch = (L: number, C: number, H: number) =>
  [L, C * Math.cos(H * D), C * Math.sin(H * D)] as const;
const inGamut = (L: number, C: number, H: number) =>
  oklabToLinear(...lch(L, C, H)).every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** Max in-gamut chroma at (L,H). Binary search, 60 iterations. */
function maxChroma(L: number, H: number) {
  let lo = 0,
    hi = 0.5;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (inGamut(L, m, H)) lo = m;
    else hi = m;
  }
  return lo;
}

/** #RRGGBB → Oklab. Brand gold is authored as hex, so it must be converted. */
function hexToOklab(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ] as const;
}
const dE = (p: readonly number[], q: readonly number[]) =>
  Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** Read the override block from the REAL stylesheet, not a copy. */
function severityTokens() {
  const css = readFileSync(join(ROOT, "app/styles/tokens.css"), "utf8");
  const out = new Map<string, { L: number; C: number; H: number }>();
  for (const m of css.matchAll(
    /--color-(rose|red|amber|emerald|sky)-(300|400)\s*:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g,
  ))
    out.set(`${m[1]}-${m[2]}`, { L: +m[3], C: +m[4], H: +m[5] });
  return out;
}

const GOLD = hexToOklab("#FDB913");
const HUES = ["rose", "red", "amber", "emerald", "sky"] as const;

describe("severity tier palette", () => {
  const tokens = severityTokens();

  it("declares all five hues at both tiers", () => {
    for (const h of HUES)
      for (const t of ["300", "400"]) {
        expect(tokens.has(`${h}-${t}`), `--color-${h}-${t} missing`).toBe(true);
      }
  });

  it.each(["300", "400"])("tier -%s shares ONE lightness", (tier) => {
    const ls = HUES.map((h) => tokens.get(`${h}-${tier}`)!.L);
    expect(new Set(ls).size, `tier -${tier} lightnesses: ${ls.join(", ")}`).toBe(1);
  });

  it("every chroma is inside its hue's max sRGB chroma (no clamping)", () => {
    for (const [name, { L, C, H }] of tokens) {
      const ceiling = maxChroma(L, H);
      expect(
        C,
        `--color-${name}: C ${C} exceeds ceiling ${ceiling.toFixed(3)} at L ${L} H ${H}`,
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  it("severity leads on saturation: critical out-chromas warning at both tiers", () => {
    // SHIPPED TAILWIND FAILS THIS: rose-300 C 0.117 < amber-300 C 0.169.
    expect(tokens.get("rose-300")!.C).toBeGreaterThan(tokens.get("amber-300")!.C);
    expect(tokens.get("rose-400")!.C).toBeGreaterThan(tokens.get("amber-400")!.C);
  });

  it("warning stays clear of brand gold #FDB913", () => {
    // Stock amber-400 vs gold is ΔE 0.0232, against a rose↔emerald reference of 0.2555.
    for (const t of ["300", "400"]) {
      const { L, C, H } = tokens.get(`amber-${t}`)!;
      expect(
        dE(lch(L, C, H), GOLD),
        `amber-${t} too close to --gold`,
      ).toBeGreaterThanOrEqual(0.1);
    }
  });

  it("guard the guard: the gamut check actually rejects an out-of-gamut value", () => {
    // Measured ceiling for amber H84.429 at L 0.66 is 0.135. A first draft used 0.150.
    expect(inGamut(0.66, 0.15, 84.429)).toBe(false);
    expect(inGamut(0.66, 0.136, 70.08)).toBe(true);
    expect(maxChroma(0.66, 84.429)).toBeLessThan(0.14);
  });
});
