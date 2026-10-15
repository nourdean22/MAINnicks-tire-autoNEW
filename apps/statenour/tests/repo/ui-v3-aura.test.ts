/**
 * UI v3 W1a: the state aura is gone, and the fix it carried stays.
 *
 * The aura (`state-aura state-aura-<state>` on a wrapper around every mastery page) is replaced by a
 * one-word state label (components/hud/state-word.tsx). The wrapper keeps `overflow-x-clip` and
 * `min-h-screen`: overflow-x-clip clips without creating a containing block, so /chat's `fixed inset-0`
 * shell and the bottom tab bar still resolve against the viewport (__tests__/state-aura-containing-block.test.ts).
 * These pins fail if the aura comes back in the stylesheet, the wrapper, or the layout.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const stripTsx = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the state aura is gone", () => {
  it("leaves no .state-aura selector and no aura keyframes in any stylesheet", () => {
    for (const f of ["app/styles/base.css", "app/styles/effects.css", "app/styles/tokens.css"]) {
      const css = stripCss(read(f));
      expect(css, `${f} still styles the aura`).not.toMatch(/state-aura/);
      expect(css, `${f} still has the aura keyframes`).not.toMatch(/@keyframes\s+state-scattered-aura/);
    }
  });

  it("leaves no state-aura class on the wrapper, which keeps the clip and min-h-screen", () => {
    const code = stripTsx(read("components/hud/ambient-aura.tsx"));
    expect(code).not.toContain("state-aura");
    expect(code).not.toContain("useNourState");
    expect(code).toContain("overflow-x-clip");
    expect(code).toContain("min-h-screen");
  });

  it("puts nothing on the wrapper that would trap a fixed descendant", () => {
    const code = stripTsx(read("components/hud/ambient-aura.tsx"));
    const classes = [...code.matchAll(/className=(?:"([^"]*)"|\{[^}]*\})/g)].map((m) => m[0]).join(" ");
    expect(classes).not.toMatch(/\b(relative|absolute|sticky|fixed|transform|translate|scale-|rotate|filter|backdrop|blur|will-change|contain-)/);
  });

  it("mounts the state word once in the mastery layout", () => {
    const layout = stripTsx(read("app/(mastery)/layout.tsx"));
    expect(layout.match(/<StateWord\b/g) ?? []).toHaveLength(1);
    expect(layout).toContain('from "@/components/hud/state-word"');
  });
});
