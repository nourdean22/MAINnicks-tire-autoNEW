/**
 * UI v2 grammar gate (2026-10-01 · docs/design/ui-v2/SYSTEM.md).
 *
 * Pins the parts of the Precision Material Cockpit that a well-meaning edit
 * could quietly undo: gold must stay a signal, element defaults must stay
 * sentence-case Geist, the dead effects classes must stay dead, and the two
 * keyframes that inline `style.animation` strings reference must stay defined
 * (the near-miss that produced this test: a census-driven prune dropped
 * `sparkline-draw` and `slideUpSheet`, which no `.tsx` references by CLASS but
 * two reference by NAME inside a style string).
 *
 * Positive control (run 2026-10-01 with GRAMMAR_ROOT pointed at the old files):
 * against c8e3287c / 4016737b (the last production grammar) 11 of the 12 tests
 * fail — gold scrollbar, uppercase h1 default, dead effects classes, no
 * data-ui lane, unregistered utilities. The keyframe block is the exception by
 * design: it is a prune-REGRESSION guard and passes on both grammars, because
 * the old sheet also defined those keyframes. Against 49592699 (the FIRST v2
 * push) all 5 "cascade defects" tests fail, which is the point of that block.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const tokens = read("app/styles/tokens.css");
const base = read("app/styles/base.css");
const effects = read("app/styles/effects.css");
const layout = read("app/layout.tsx");

/** PR 3 (2026-10-02) deleted the `?ui=v1` comparison lane, so the whole sheet is the v2 grammar. */
const baseV2 = base;
const tokensV2 = tokens;

describe("UI v2 grammar", () => {
  it("declares the semantic surface roles and keeps the legacy aliases pointing at them", () => {
    for (const t of ["--canvas", "--workspace", "--surface", "--surface-raised", "--surface-interactive", "--edge-subtle", "--edge-strong", "--accent", "--radius-control", "--motion-state", "--focus-ring"]) {
      expect(tokens, `${t} missing`).toMatch(new RegExp(`^\\s*${t}:`, "m"));
    }
    expect(tokens).toMatch(/--bg-void:\s*var\(--canvas\)/);
    expect(tokens).toMatch(/--gold:\s*var\(--accent\)/);
  });

  it("gold is a signal: no gold scrollbar, no gold glow, no gold in any shadow token", () => {
    // Gold BORDERS on active / focus / doing states are sanctioned signals
    // (.neural-glass-active, .neural-glass:focus-within, task-doing-breath);
    // gold scrollbars and gold glows are decoration.
    expect(effects).toMatch(/::-webkit-scrollbar-thumb \{ background: rgba\(255, 255, 255/);
    expect(effects).not.toMatch(/scrollbar-thumb \{[^}]*253, 185, 19/);
    expect(effects).not.toMatch(/box-shadow: 0 0 40px rgba\(253, 185, 19/);
    for (const line of tokensV2.split("\n").filter((l) => /^\s*--shadow-/.test(l))) {
      expect(line, "a shadow token carries gold").not.toMatch(/253,\s*185,\s*19/);
    }
  });

  it("element headings are Geist and sentence case by default (uppercase is opt-in via eyebrow/verdict)", () => {
    const h1 = baseV2.match(/^\s*h1 \{[^}]*\}/m)?.[0] ?? "";
    expect(h1, "h1 rule missing").not.toBe("");
    expect(h1).not.toContain("uppercase");
    expect(baseV2).toMatch(/h1, h2, h3 \{ font-family: var\(--font-body\)/);
    // The element defaults MUST sit in @layer base: unlayered, they beat every Tailwind utility and
    // `<h2 className="text-[26px]">` rendered at the 17px default (hostile review, 2026-10-01).
    const layered = baseV2.match(/@layer base \{[^}]*h1, h2, h3 \{/);
    expect(layered, "h1/h2/h3 defaults are not inside @layer base").not.toBeNull();
    expect(baseV2).toMatch(/\.page-title \{[^}]*text-transform: none/);
    expect(baseV2).toMatch(/\.vt-verdict \{[^}]*font-family: var\(--font-display\)/);
  });

  it("the dead effects classes stay dead", () => {
    for (const cls of ["nick-orb-idle", "neon-gold", "hud-shimmer", "particle-burst", "glitch-text", "btn-gold", "data-stream", "float-particle"]) {
      expect(effects, `.${cls} is back`).not.toMatch(new RegExp(`^\\.${cls}(?![\\w-])`, "m"));
    }
    // built dynamically (state-aura-<state>) — looks dead to a class census, is not
    expect(effects).toMatch(/^\.state-aura-drift/m);
    // the class the first prune DID drop while six consumers were live (hostile review, 2026-10-01)
    expect(effects).toMatch(/^\.animate-fade-in-scale \{ animation: fade-in-scale/m);
  });

  it("keyframes referenced from inline style strings survive pruning", () => {
    expect(effects).toMatch(/@keyframes sparkline-draw\s*\{/);
    expect(effects).toMatch(/@keyframes slideUpSheet\s*\{/);
    expect(read("components/ui/sparkline.tsx")).toContain("sparkline-draw");
    expect(read("components/chat/message-action-sheet.tsx")).toContain("slideUpSheet");
  });

  it("the v1 comparison lane is gone: no data-ui gate, no cookie read, no switch, no particle canvas", () => {
    // PR 3 (2026-10-02). The lane was migration scaffolding (`?ui=v1` → cookie → `<html data-ui>` →
    // `:root[data-ui="v1"]` blocks); keeping it meant every v2 rule had to be written twice and the
    // particle canvas stayed mounted for nobody. Positive control: on 1dfcfa2c every line below fails.
    expect(tokens).not.toContain('data-ui');
    expect(base).not.toContain('data-ui');
    expect(layout).not.toMatch(/data-ui|ui-version|UiVersionSwitch|cookies\(\)/);
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    for (const gone of ["lib/ui-version.ts", "components/ui/ui-version-switch.tsx", "components/hud/neural-background.tsx"]) {
      expect(existsSync(join(ROOT, gone)), `${gone} should be deleted`).toBe(false);
    }
    expect(read("lib/feature-flags.ts")).not.toContain("STATENOUR_UI");
  });

  it("content never gets translucent material; only the ui-material class does", () => {
    expect(baseV2).toMatch(/\.ui-material \{[^}]*backdrop-filter/);
    const glass = baseV2.match(/\.glass-card \{[^}]*\}/)?.[0] ?? "";
    expect(glass).not.toContain("backdrop-filter");
  });
});

describe("UI v2 cascade defects found by the 2026-10-01 hostile review stay fixed", () => {
  it("every utility the v2 components use is registered in the theme bridge", () => {
    const theme = tokens.match(/@theme inline \{[\s\S]*?\n\}/)?.[0] ?? "";
    for (const t of ["--color-edge-default", "--color-edge-subtle", "--color-edge-strong", "--color-content", "--color-surface-interactive", "--color-overlay", "--color-canvas", "--radius-control", "--shadow-l1"]) {
      expect(theme, `${t} is not registered — the utility emits zero CSS`).toContain(`${t}:`);
    }
    // bg-surface is the legacy alias of --surface-interactive; the content-card role is bg-content
    expect(theme).toMatch(/--color-content: var\(--surface\)/);
  });

  it("the v2 focus ring is the only focus rule; the legacy !important gold outline is gone", () => {
    expect(baseV2).toMatch(/:focus-visible \{\s*outline: none;\s*box-shadow: var\(--focus-ring\);\s*\}/);
    expect(effects).not.toMatch(/:focus-visible \{[^}]*!important/);
    expect(effects).not.toMatch(/outline: 1\.5px solid var\(--gold\)/);
  });

  it("no unlayered element transition overrides a component's transition utilities", () => {
    const unlayered = effects.replace(/@layer base \{[\s\S]*?\n\}/g, "");
    expect(unlayered).not.toMatch(/^button, \[role="button"\] \{\s*transition:/m);
    expect(unlayered).not.toMatch(/^button, a, input, \[role="button"\] \{\s*transition:/m);
  });

  it("the canonical card is a solid surface: no gradient, no gold edge, no gold top line, no scanline overlay", () => {
    const glass = effects.match(/\n\.neural-glass \{[^}]*\}/)?.[0] ?? "";
    expect(glass).toContain("background: var(--surface)");
    expect(glass).not.toContain("253, 185, 19");
    expect(glass).not.toContain("linear-gradient");
    expect(effects).not.toMatch(/\.neural-glass::before/);
    expect(effects).not.toMatch(/body::after/);
    expect(effects).not.toMatch(/\.skeleton \{[^}]*253, 185, 19/);
  });

  it("the v2 type floor and tracking cap apply at every width, unconditionally", () => {
    expect(baseV2).toMatch(/^\[class\*="text-\[9px\]"\],\s*\[class\*="text-\[10px\]"\] \{ font-size: 11px; \}/m);
    expect(baseV2).toMatch(/\[class\*="tracking-\[0\.18em\]"\][\s\S]{0,120}letter-spacing: 0\.12em/);
  });
});

describe("Tailwind source scanning", () => {
  it("every bracketed var() class in a scanned file names a real custom property (anything else gets minted and breaks the stylesheet)", () => {
    // 2026-10-01: prose in PLAN.md spelled a radius class with an asterisk, then an ellipsis, inside the var()
    // brackets. Tailwind v4 auto-source reads Markdown and this test file, minted both as utilities, and the
    // generated stylesheet failed to parse (Delim('*'), then Ident("…")) — every page 500'd in two e2e runs.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const files = execSync("git ls-files -- '*.md' '*.mdx' '*.tsx' '*.ts' '*.json'", { cwd: ROOT, encoding: "utf8" })
      .split("\n").filter(Boolean);
    // valid: -[var(--name)] or -[var(--name,fallback)]; everything else inside the brackets is a defect
    const bad = /-\[var\((?!--[A-Za-z0-9_-]+(?:,[^)\]]*)?\)\])/;
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), "utf8");
      const m = src.match(bad);
      if (m) offenders.push(`${f}: ${src.slice(m.index!, m.index! + 40)}`);
    }
    expect(offenders, "bracketed var() class reachable by the Tailwind scanner with a bad argument").toEqual([]);
  });
});

/**
 * Every custom property a class or inline style reads must be DEFINED somewhere: in app/styles, or as a
 * string literal in app/components/lib (the inline `style={{ "--x": … }}` definers), or on the short
 * allowlist of library-owned names. A `var(--x)` with no definition resolves to nothing — the utility emits,
 * the element paints transparent — and the bracket-syntax test above cannot see it (2026-10-02 hostile
 * review: four brain inputs on `--bg-overlay`, a panel on `--bg-secondary`, labels on `--text-muted`).
 */
export function undefinedCustomProperties(sources: Record<string, string>, defined: Set<string>): string[] {
  const use = /(?:var\(|[a-z-]+-\()(--[A-Za-z0-9_-]+)/g;
  const out: string[] = [];
  for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(use)) {
      const name = m[1];
      if (!defined.has(name)) out.push(`${file}: ${name}`);
    }
  }
  return [...new Set(out)];
}

describe("custom properties read by the app are defined", () => {
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  const LIBRARY_OWNED = new Set([
    "--font-geist-sans", "--font-geist-mono", // set on <html> by the geist package (app/layout.tsx)
    "--transform-origin", "--radix-popover-content-transform-origin", "--anchor-width", "--available-height", "--available-width", "--positioner-width"]);
  const defined = (): Set<string> => {
    const set = new Set<string>(LIBRARY_OWNED);
    const css = execSync("git ls-files -- 'app/styles/*.css' 'app/globals.css'", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    for (const f of css) {
      // Only runtime-scoped definitions count, so not `@theme inline` (Tailwind v4 emits no custom
      // property for an inline theme entry, so `var(--color-content)` is dead at runtime).
      const runtime = read(f).replace(/@theme inline\s*\{[^}]*\}/g, "");
      for (const m of runtime.matchAll(/(?:^|[{;])\s*(--[A-Za-z0-9_-]+)\s*:/gm)) set.add(m[1]);
    }
    const ts = execSync("git ls-files -- 'app/**/*.ts' 'app/**/*.tsx' 'components/**/*.tsx' 'lib/**/*.ts' 'lib/**/*.tsx'", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    // A string literal defines a property only as an object key (`"--x": …`), a named constant
    // (`const X_VAR = "--x"`), or a setProperty target — a read (`getPropertyValue("--x")`) does not.
    const definer = /(?:["'`](--[A-Za-z0-9_-]+)["'`]\s*:|_VAR\s*=\s*["'`](--[A-Za-z0-9_-]+)["'`]|setProperty\(\s*["'`](--[A-Za-z0-9_-]+)["'`])/g;
    for (const f of ts) for (const m of read(f).matchAll(definer)) set.add(m[1] ?? m[2] ?? m[3]);
    return set;
  };

  it("positive control: a planted undefined property is reported", () => {
    const hits = undefinedCustomProperties({ "x.tsx": 'className="bg-[var(--definitely-not-defined)]"' }, defined());
    expect(hits).toEqual(["x.tsx: --definitely-not-defined"]);
    expect(undefinedCustomProperties({ "y.tsx": 'className="bg-[var(--canvas)] text-(--text-tertiary)"' }, defined())).toEqual([]);
  });

  it("no .tsx under app/ or components/ reads a custom property that nothing defines", () => {
    const files = execSync("git ls-files -- 'app/**/*.tsx' 'components/**/*.tsx'", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    const sources: Record<string, string> = {};
    for (const f of files) sources[f] = read(f);
    expect(undefinedCustomProperties(sources, defined())).toEqual([]);
  });
});
