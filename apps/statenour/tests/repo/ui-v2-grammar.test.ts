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
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Tracked files matching git pathspecs. execFile, not a shell: cmd.exe keeps single quotes, so `'*.md'` matched nothing on Windows. */
const gitFiles = (...specs: string[]) =>
  execFileSync("git", ["ls-files", "--", ...specs], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
/** Every .ts/.tsx a class string can live in, tracked or not (a new file must not slip past). */
function uiFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(join(ROOT, p)).isDirectory()) return uiFiles(p);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(name) ? [relative(ROOT, join(ROOT, p)).replaceAll("\\", "/")] : [];
  });
}
const UI_FILES = ["app", "components", "features", "hooks", "lib"].flatMap(uiFiles);

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
    // Gold BORDERS on active / focus states are sanctioned signals
    // (.neural-glass-active, .neural-glass:focus-within);
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
    // UI v3 W1a removed the state aura (state-aura-<state>); the state is a one-word label now.
    // tests/repo/ui-v3-aura.test.ts and __tests__/state-aura-containing-block.test.ts fail if it returns.
    expect(effects).not.toMatch(/\.state-aura/);
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
    expect(baseV2).toMatch(/:focus-visible \{\s*outline: 2px solid transparent;\s*outline-offset: 2px;\s*box-shadow: var\(--focus-ring\);\s*\}/);
    expect(effects).not.toMatch(/:focus-visible \{[^}]*!important/);
    expect(effects).not.toMatch(/outline: 1\.5px solid var\(--gold\)/);
  });

  it("the focus ring survives forced-colors mode (09-F15): a transparent outline backs the box-shadow", () => {
    // Forced colors drop box-shadow; a transparent outline is repainted in the system colour,
    // `outline: none` leaves nothing. Red on the pre-fix sheet (`outline: none`).
    const rule = baseV2.match(/:focus-visible \{[^}]*\}/)?.[0] ?? "";
    expect(rule, "focus rule missing").not.toBe("");
    expect(rule).not.toMatch(/outline:\s*(none|0)\b/);
    expect(rule).toMatch(/outline: 2px solid transparent/);
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

/**
 * SYSTEM.md §1.4 / §13 (09-F14, 2026-10-10): nothing animates at rest except a WORKING state.
 * The page-wrapper aura breathed red forever while any drift alert was open; stale pins, streak
 * fire and DOING rows breathed too, each already carrying its colour and word. Positive control:
 * on the pre-fix sheet the infinite-animation set also held the three state auras, the two pin
 * breathes, .streak-fire and .animate-breath, and four .tsx files applied those classes.
 */
describe("nothing animates at rest (only working states loop)", () => {
  /** More iterations than this is a loop in all but name (`animation: breathe 3s 99999`). */
  const MAX_ITERATIONS = 3;

  /**
   * Selectors whose rule loops an animation, comments and @keyframes bodies stripped. Reads `animation`,
   * `animation-iteration-count` and Tailwind v4 `--animate-*` theme tokens (each registers an `animate-*`
   * utility). A loop is the standalone token `infinite` (a keyframe NAMED `infinite-scroll` is not) or a
   * count above MAX_ITERATIONS. A token is reported as "<selector> <--animate-name>".
   */
  function infiniteSelectors(css: string): string[] {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const out: string[] = [];
    for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const decl of m[2].split(";")) {
        const at = decl.indexOf(":");
        const prop = decl.slice(0, at).trim();
        if (at < 0 || !/^(animation|animation-iteration-count|--animate-[\w-]+)$/.test(prop)) continue;
        // Parenthesised arguments (cubic-bezier, steps, var) hold no iteration count.
        const tokens = decl.slice(at + 1).replace(/\([^()]*\)/g, " ").split(/[\s,]+/);
        if (tokens.some((t) => t === "infinite" || (/^\d+(\.\d+)?$/.test(t) && Number(t) > MAX_ITERATIONS))) {
          out.push(prop.startsWith("--") ? `${m[1].trim()} ${prop}` : m[1].trim());
        }
      }
    }
    return out;
  }

  /** Comments out, URLs (`https://`) kept, so a note naming a retired class is not an application of it. */
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  /**
   * Loops a component applies with no stylesheet rule: Tailwind's built-in pulse/ping/bounce, an arbitrary
   * `animate-[... infinite]`, an inline `animation: "... infinite"`. `animate-spin` is not here: a spinner
   * IS a working indicator.
   */
  const LOOP_CLASS = /\banimate-(?:pulse|ping|bounce)\b|\banimate-\[[^\]\s]*(?<![a-z-])infinite(?![\w-])[^\]\s]*\]|animation:\s*["'`][^"'`;]*(?<![\w-])infinite(?![\w-])/g;
  /**
   * A loop is WORKING when the file is a skeleton, the component it sits in is named for one
   * (`StatsBodyFallback`, `LoadingRow`), or a working word sits within the six lines that end on it: the
   * `if (loading)` / `fallback={` / `loading: () =>` / `isPending &&` branch that renders it.
   * shortcut: a word near the class, not data flow. A "pending" list badge that pulsed at rest would
   * pass; read the branch condition with the syntax tree if that ever happens.
   */
  const WORKING = /loading|skeleton|fallback|pending|suspense|checking|streaming|running|shimmer/i;
  const RETIRED = ["pin-stale-breathe", "pin-very-stale-breathe", "streak-fire", "animate-breath"];

  /** Every at-rest loop one source file applies, as "<file> -> <class>". */
  function atRestLoops(file: string, src: string): string[] {
    const lines = stripComments(src).split("\n");
    const out: string[] = [];
    let component = "";
    lines.forEach((line, i) => {
      component = /\b(?:function|const)\s+([A-Z]\w*)/.exec(line)?.[1] ?? component;
      for (const cls of RETIRED) if (new RegExp(`(?<![\\w-])${cls}(?![\\w-])`).test(line)) out.push(`${file} -> ${cls}`);
      for (const m of line.matchAll(LOOP_CLASS)) {
        const near = `${component}\n${lines.slice(Math.max(0, i - 6), i + 1).join("\n")}`;
        if (!/skeleton/i.test(file) && !WORKING.test(near)) out.push(`${file} -> ${m[0]}`);
      }
    });
    return out;
  }

  /**
   * Empty since R3-06 (2026-10-11, P-S7a) stopped the mode-learn "Time's up" bounce. A new entry needs an
   * owner and a date; the reverse canary fails once a listed loop is gone.
   */
  const KNOWN_AT_REST = new Set<string>([]);

  it("positive control: the scan finds a planted at-rest loop, in a sheet and in a component", () => {
    expect(infiniteSelectors(".x { color: red; }\n.y { animation: spin 1s linear infinite; }")).toEqual([".y"]);
    expect(infiniteSelectors("@theme { --animate-breathe: breathe 3s ease-in-out infinite; }")).toEqual(["@theme --animate-breathe"]);
    expect(infiniteSelectors(".z { animation: breathe 3s ease-in-out 99999; }")).toEqual([".z"]);
    expect(infiniteSelectors(".m { animation: infinite-scroll 20s cubic-bezier(0.4, 0, 0.2, 1) 1; }")).toEqual([]);
    const planted = [
      '<div className="animate-bounce">Time\'s up</div>',
      'className={cn("dot", stale && "animate-pulse")}',
      '<span className="animate-[breathe_3s_ease-in-out_infinite]" />',
      '<span style={{ animation: "breathe 3s ease-in-out infinite" }} />',
      'const c = cn("row", isDoing && "animate-breath");',
    ].join("\n\n\n\n\n\n\n");
    expect(atRestLoops("components/x.tsx", planted)).toEqual([
      "components/x.tsx -> animate-bounce",
      "components/x.tsx -> animate-pulse",
      "components/x.tsx -> animate-[breathe_3s_ease-in-out_infinite]",
      'components/x.tsx -> animation: "breathe 3s ease-in-out infinite',
      "components/x.tsx -> animate-breath",
    ]);
    // Working states, comments and spinners pass.
    expect(atRestLoops("components/x.tsx", 'if (loading) return <div className="h-4 animate-pulse" />;')).toEqual([]);
    expect(atRestLoops("components/x.tsx", `function RowFallback() {${"\n".repeat(9)}<div className="animate-pulse" />`)).toEqual([]);
    expect(atRestLoops("components/x.tsx", `function StaleDot() {${"\n".repeat(9)}<div className="animate-pulse" />`)).toEqual(["components/x.tsx -> animate-pulse"]);
    expect(atRestLoops("components/x-skeleton.tsx", '<div className="before:animate-[shimmer_2s_ease-in-out_infinite]" />')).toEqual([]);
    expect(atRestLoops("components/x.tsx", "// the animate-breath loop was retired\n{/* animate-bounce */}")).toEqual([]);
    expect(atRestLoops("components/x.tsx", '<Loader2 className="animate-spin" />')).toEqual([]);
  });

  it("only working-state selectors loop: live pulse, loading skeleton, running tool", () => {
    const sheets = [effects, base, tokens];
    expect(sheets.flatMap(infiniteSelectors).sort()).toEqual([".chat-tool-shimmer::before", ".pulse-live", ".skeleton"]);
  });

  it("no component applies a retired at-rest animation class", () => {
    // The instrument reads the whole UI tree, not three pinned files.
    expect(UI_FILES.length).toBeGreaterThan(800);
    const loops = UI_FILES.flatMap((f) => atRestLoops(f, read(f))).filter((l) => !KNOWN_AT_REST.has(l));
    expect(loops, `at-rest loops (SYSTEM.md §1.4: only a working state animates):\n  ${loops.join("\n  ")}`).toEqual([]);
  });

  it("REVERSE CANARY: every KNOWN_AT_REST entry still loops (delete it once fixed)", () => {
    const live = new Set(UI_FILES.flatMap((f) => atRestLoops(f, read(f))));
    const fixed = [...KNOWN_AT_REST].filter((k) => !live.has(k));
    expect(fixed, `fixed, so remove from KNOWN_AT_REST:\n  ${fixed.join("\n  ")}`).toEqual([]);
  });
});

/**
 * SYSTEM.md section 3: gold is "never a hover", and the notch is "the only gold that appears without the
 * operator acting" (section 12). Audit 09-X1 (2026-10-10): the Waiting rows turned their text gold on hover
 * and The Brief carried a second at-rest notch beside the NOW notch. Red on that tree: the hover scan
 * found waiting-line.tsx -> hover:text-gold and the Home notch scan found brief-lead.tsx.
 */
describe("gold stays a signal on Home and in hovers (09-X1)", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  /**
   * A hover that turns text, a border, a ring or an outline gold, by name (gold, accent) or by value.
   * shortcut: every bg-* hover passes (bg-accent-hover, bg-accent-medium, bg-[var(--gold)]/25 are the
   * pressed steps of a control that is already gold); a neutral button that fills gold on hover would
   * pass too. Read the at-rest class beside it if that ever ships.
   */
  function goldHovers(file: string, src: string): string[] {
    const out: string[] = [];
    for (const m of strip(src).matchAll(/(?<![\w-])(?:[\w-]+:)*[\w-]*hover:[^\s"'`]+/g)) {
      const utility = m[0].replace(/^(?:[\w-]+:)+/, "");
      if (utility.startsWith("bg-")) continue;
      const byValue = /gold|#fdb913|253,\s*185,\s*19/i.test(utility);
      const byName = /^(?:text|border(?:-[trblxy])?|outline|ring|decoration|fill|stroke)-(?:accent(?:-[\w]+)?(?:\/\d+)?$|\[[^\]]*--accent[^\]]*\])/.test(utility);
      if (byValue || byName) out.push(`${file} -> ${m[0]}`);
    }
    return out;
  }

  /** Files that apply the .notch class (a class token, not a word in a comment or an identifier). */
  const notchFiles = (files: string[]) =>
    files.filter((f) => /["'`\s]notch(?=["'`\s])/.test(strip(read(f))));

  it("positive control: a planted gold hover is caught in every spelling; fills, at-rest gold and comments are not", () => {
    expect(goldHovers("x.tsx", 'className="text-fg hover:text-gold"')).toEqual(["x.tsx -> hover:text-gold"]);
    expect(goldHovers("x.tsx", 'className="md:group-hover:border-accent/40"')).toEqual(["x.tsx -> md:group-hover:border-accent/40"]);
    expect(goldHovers("x.tsx", 'className="hover:text-[var(--gold)]"')).toEqual(["x.tsx -> hover:text-[var(--gold)]"]);
    expect(goldHovers("x.tsx", 'className="hover:ring-[#FDB913]"')).toEqual(["x.tsx -> hover:ring-[#FDB913]"]);
    expect(goldHovers("x.tsx", 'className="bg-accent hover:bg-accent-hover text-gold"')).toEqual([]);
    expect(goldHovers("x.tsx", 'className="bg-[var(--gold)]/15 hover:bg-[var(--gold)]/25"')).toEqual([]);
    expect(goldHovers("x.tsx", 'className="hover:bg-raised hover:text-fg"')).toEqual([]);
    expect(goldHovers("x.tsx", "// was hover:text-gold (09-X1)\nconst a = 1;")).toEqual([]);
  });

  it("gold is never a hover", () => {
    expect(UI_FILES.flatMap((f) => goldHovers(f, read(f)))).toEqual([]);
  });

  it("positive control: the notch scan reads a class token, not a comment or an identifier", () => {
    expect(/["'`\s]notch(?=["'`\s])/.test(strip('<span className="notch h-3" aria-hidden />'))).toBe(true);
    expect(/["'`\s]notch(?=["'`\s])/.test(strip("// NEW notch, small gold arc\nconst notchColor = 1;"))).toBe(false);
  });

  it("Home has one at-rest notch outside nav: the NOW line", () => {
    const home = UI_FILES.filter((f) => f.startsWith("components/home/"));
    expect(home.length, "the scan found no Home files").toBeGreaterThan(5);
    expect(notchFiles(home)).toEqual(["components/home/brief-state-line.tsx"]);
  });
});

describe("Tailwind source scanning", () => {
  it("every bracketed var() class in a scanned file names a real custom property (anything else gets minted and breaks the stylesheet)", () => {
    // 2026-10-01: prose in PLAN.md spelled a radius class with an asterisk, then an ellipsis, inside the var()
    // brackets. Tailwind v4 auto-source reads Markdown and this test file, minted both as utilities, and the
    // generated stylesheet failed to parse (Delim('*'), then Ident("…")) — every page 500'd in two e2e runs.
    const files = gitFiles("*.md", "*.mdx", "*.tsx", "*.ts", "*.json");
    expect(files.length, "git ls-files matched nothing: the scan would pass vacuously").toBeGreaterThan(1000);
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
  const LIBRARY_OWNED = new Set([
    "--font-geist-sans", "--font-geist-mono", // set on <html> by the geist package (app/layout.tsx)
    "--transform-origin", "--radix-popover-content-transform-origin", "--anchor-width", "--available-height", "--available-width", "--positioner-width"]);
  const defined = (): Set<string> => {
    const set = new Set<string>(LIBRARY_OWNED);
    const css = gitFiles("app/styles/*.css", "app/globals.css");
    for (const f of css) {
      // Only runtime-scoped definitions count, so not `@theme inline` (Tailwind v4 emits no custom
      // property for an inline theme entry, so `var(--color-content)` is dead at runtime).
      const runtime = read(f).replace(/@theme inline\s*\{[^}]*\}/g, "");
      for (const m of runtime.matchAll(/(?:^|[{;])\s*(--[A-Za-z0-9_-]+)\s*:/gm)) set.add(m[1]);
    }
    const ts = gitFiles("app/**/*.ts", "app/**/*.tsx", "components/**/*.tsx", "lib/**/*.ts", "lib/**/*.tsx");
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

  it("no .tsx under app/, components/, features/, hooks/ or lib/ reads a custom property that nothing defines", () => {
    const files = gitFiles("app/**/*.tsx", "components/**/*.tsx", "features/**/*.tsx", "hooks/**/*.tsx", "lib/**/*.tsx");
    expect(files.length, "git ls-files matched nothing: the scan would pass vacuously").toBeGreaterThan(300);
    const sources: Record<string, string> = {};
    for (const f of files) sources[f] = read(f);
    expect(undefinedCustomProperties(sources, defined())).toEqual([]);
  });
});
