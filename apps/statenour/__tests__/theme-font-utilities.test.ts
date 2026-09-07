/**
 * 2026-09-07 · Tailwind v4 FONT utilities must reference the fonts the app loads.
 *
 * THE LIVE DEFECT THIS PINS. `font-mono` is used across 200+ files for every
 * eyebrow, label and timestamp, and DESIGN.md says mono = Geist Mono. But
 * Tailwind v4 builds `font-mono` from `--font-mono` in @theme, and the bridge
 * in app/styles/tokens.css never declared it — so the utility emitted
 * Tailwind's default stack (ui-monospace, SFMono-Regular, Menlo, …) and the
 * operator saw Consolas on Windows and SF Mono on iOS, while next/font kept
 * preloading Geist Mono on every cold load. Measured on the live Home page:
 * `document.fonts` reported `GeistMono: unloaded` with the woff2 already
 * downloaded. Same silent-default class as __tests__/theme-token-utilities.
 *
 * Reads the ACTUAL bridge and the ACTUAL layout, and asserts values rather
 * than mentions — a comment quoting the old default must not satisfy this.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** `--font-<name>: <value>` declarations inside the first @theme block, comments removed. */
function themeFontDeclarations(): Record<string, string> {
  const css = readFileSync(join(ROOT, "app/styles/tokens.css"), "utf8");
  const start = css.indexOf("@theme");
  expect(start, "tokens.css must carry an @theme bridge").toBeGreaterThan(-1);
  const block = stripComments(css.slice(start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--font-([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

describe("font utilities are bridged to the loaded fonts", () => {
  const fonts = themeFontDeclarations();

  it("font-mono resolves to the Geist Mono variable next/font publishes", () => {
    expect(fonts.mono, "--font-mono must be declared in @theme").toBeTruthy();
    expect(fonts.mono.startsWith("var(--font-geist-mono)"), `got: ${fonts.mono}`).toBe(true);
    // The variable it references is really set on <html> by the root layout.
    const layout = stripComments(readFileSync(join(ROOT, "app/layout.tsx"), "utf8"));
    expect(layout).toMatch(/import \{ GeistMono \} from "geist\/font\/mono"/);
    expect(layout).toMatch(/GeistMono\.variable/);
  });

  it("font-sans resolves to the body stack (Geist Sans), not Tailwind's default", () => {
    expect(fonts.sans, "--font-sans must be declared in @theme").toBeTruthy();
    expect(fonts.sans.startsWith("var(--font-body)"), `got: ${fonts.sans}`).toBe(true);
    const root = stripComments(readFileSync(join(ROOT, "app/styles/tokens.css"), "utf8"));
    expect(root).toMatch(/--font-body\s*:\s*var\(--font-geist-sans\)/);
  });

  it("positive control: the utilities this bridge feeds are actually used", () => {
    // If nothing used font-mono the bridge would be dead weight and this file
    // would be guarding an empty room.
    const files = execFileSync("git", ["grep", "-l", "font-mono", "--", "app", "components"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(50);
  });
});
