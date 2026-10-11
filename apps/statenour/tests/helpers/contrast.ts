/**
 * WCAG 2.x contrast helpers for tests (moved out of empty-state-contrast.test.tsx, audit 09-X7).
 * Colours are read from app/styles/tokens.css (the source of truth) and, for stock Tailwind names the
 * repo does not override, from node_modules/tailwindcss/theme.css.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
export const TOKENS_CSS = readFileSync(join(ROOT, "app/styles/tokens.css"), "utf8");
const TAILWIND_THEME_CSS = readFileSync(join(ROOT, "node_modules/tailwindcss/theme.css"), "utf8");

/** `--name: #RRGGBB` on its own declaration. */
export function tokenHex(name: string): string {
  const m = TOKENS_CSS.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\b`));
  if (!m) throw new Error(`token --${name} not found as a hex value`);
  return m[1];
}

/** `--color-x: oklch(...);   /* #RRGGBB ...` (the palette block records the sRGB hex). */
export function paletteHex(name: string): string {
  const m = TOKENS_CSS.match(new RegExp(`--color-${name}:[^;]+;\\s*/\\*\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`palette --color-${name} hex comment not found`);
  return m[1];
}

export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");

/** CSS oklch() to sRGB hex (Bjorn Ottosson's OKLab matrices). shortcut: clamps out-of-gamut channels; exact for this palette. */
export function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.sign(x) * Math.abs(x) ** (1 / 2.4) - 0.055);
  return `#${lin.map((x) => hex2(gamma(x))).join("")}`.toUpperCase();
}

/** sRGB hex of a foreground at `alpha` composited over `bg` (what the browser paints for `text-x/NN`). */
export function blend(fg: string, alpha: number, bg: string): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return `#${[1, 3, 5].map((i) => hex2(alpha * ch(fg, i) + (1 - alpha) * ch(bg, i))).join("")}`.toUpperCase();
}

/** The value a custom property is declared with: the repo's tokens first (they override stock Tailwind). */
function declared(prop: string): string | null {
  for (const css of [TOKENS_CSS, TAILWIND_THEME_CSS]) {
    const m = css.match(new RegExp(`(?:^|[\\s{;])${prop.replace(/[-]/g, "\\-")}:\\s*([^;]+);`, "m"));
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * A custom property (`--text-tertiary`, `--color-red-300`) to sRGB hex, following var() chains.
 * Returns null for anything that is not a plain hex or oklch() (rgba, color-mix): unknown, never a pass.
 */
export function resolveColor(prop: string, depth = 0): string | null {
  const v = declared(prop);
  if (!v || depth > 6) return null;
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolveColor(ref[1], depth + 1);
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) return `#${hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1]}`.toUpperCase();
  const ok = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (ok) return oklchToHex(Number(ok[1]) / (ok[2] ? 100 : 1), Number(ok[3]), Number(ok[4]));
  return null;
}
