/**
 * UI v3 W1a, spring easing tokens (docs/design/ui-v3/PLAN.md section 4).
 *
 * Two CSS `linear()` springs, --ease-spring-soft (settles: sheet and popover open) and --ease-spring-snap
 * (press), each defined first as a cubic-bezier and then overridden inside
 * @supports (transition-timing-function: linear(0, 1)), so a browser without linear() keeps a curve.
 * They are spent on at most four existing motion sites, no duration over 300 ms, no `transition: all`,
 * no new keyframes. The `:active` press scale lives inside prefers-reduced-motion: no-preference.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

const TOKENS = stripComments(read("app/styles/tokens.css"));
const EFFECTS = stripComments(read("app/styles/effects.css"));
const BASE = stripComments(read("app/styles/base.css"));
const ALL = `${TOKENS}\n${BASE}\n${EFFECTS}`;
const SOFT = "--ease-spring-soft";
const SNAP = "--ease-spring-snap";

interface Rule {
  selector: string;
  body: string;
  /** The at-rule preludes this rule sits inside, outermost first. */
  within: string[];
}

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const stack: { prelude: string; at: boolean; start: number; rule?: Rule }[] = [];
  let last = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      const prelude = css.slice(last, i).trim();
      const at = prelude.startsWith("@");
      const entry: { prelude: string; at: boolean; start: number; rule?: Rule } = { prelude, at, start: i + 1 };
      if (!at) {
        entry.rule = { selector: prelude, body: "", within: stack.filter((s) => s.at).map((s) => s.prelude) };
        out.push(entry.rule);
      }
      stack.push(entry);
      last = i + 1;
    } else if (ch === "}") {
      const top = stack.pop();
      if (top?.rule) top.rule.body = css.slice(top.start, i);
      last = i + 1;
    } else if (ch === ";") {
      last = i + 1;
    }
  }
  return out;
}

const ALL_RULES = rules(ALL);
/** Every duration in a declaration block, with var(--motion-*) resolved from tokens.css. */
const ms = (decl: string) => {
  const resolved = decl.replace(/var\((--motion-[\w-]+)\)/g, (whole, name: string) => TOKENS.match(new RegExp(`${name}:\\s*([\\d.]+ms)`))?.[1] ?? whole);
  const v: number[] = [];
  for (const m of resolved.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) v.push(parseFloat(m[1]) * (m[2] === "s" ? 1000 : 1));
  return v;
};

describe("spring tokens", () => {
  it("defines both as a cubic-bezier fallback in :root", () => {
    const root = ALL_RULES.filter((r) => r.selector === ":root" && r.within.length === 0).map((r) => r.body).join("\n");
    expect(root).toMatch(new RegExp(`${SOFT}:\\s*cubic-bezier\\(`));
    expect(root).toMatch(new RegExp(`${SNAP}:\\s*cubic-bezier\\(`));
  });

  it("overrides both with linear() only inside @supports (transition-timing-function: linear(0, 1))", () => {
    const supported = ALL_RULES.filter((r) => r.within.some((w) => /^@supports\s*\(\s*transition-timing-function:\s*linear\(0,\s*1\)\s*\)/.test(w)));
    const body = supported.map((r) => r.body).join("\n");
    expect(body).toMatch(new RegExp(`${SOFT}:\\s*linear\\(0,`));
    expect(body).toMatch(new RegExp(`${SNAP}:\\s*linear\\(0,`));
    // a linear() anywhere else would break a browser without it
    const bare = ALL_RULES.filter((r) => /linear\(0,/.test(r.body) && !supported.includes(r));
    expect(bare.map((r) => r.selector)).toEqual([]);
  });

  it("the fallback is declared before the @supports override, so the override wins where it parses", () => {
    const fallback = ALL.search(new RegExp(`${SOFT}:\\s*cubic-bezier`));
    const supports = ALL.search(/@supports\s*\(\s*transition-timing-function:\s*linear\(0,\s*1\)/);
    expect(fallback).toBeGreaterThan(-1);
    expect(supports).toBeGreaterThan(fallback);
  });

  it("a linear() spring starts at 0, ends at 1 and settles (the last stop is 1)", () => {
    for (const token of [SOFT, SNAP]) {
      const m = ALL.match(new RegExp(`${token}:\\s*linear\\(([^)]*)\\)`));
      expect(m, token).not.toBeNull();
      const stops = m![1].split(",").map((s) => s.trim());
      expect(stops[0]).toBe("0");
      expect(stops[stops.length - 1]).toBe("1");
      expect(stops.length).toBeGreaterThan(8);
    }
  });
});

describe("where the springs are spent", () => {
  const users = ALL_RULES.filter((r) => r.body.includes(`var(${SOFT})`) || r.body.includes(`var(${SNAP})`));

  it("is at most four rules, none of them a new keyframe", () => {
    expect(users.length).toBeGreaterThan(0);
    expect(users.length).toBeLessThanOrEqual(4);
    expect(ALL).not.toMatch(/@keyframes\s+[\w-]*(spring|press)[\w-]*/i);
  });

  it("takes no duration over 300 ms in any rule that uses a spring", () => {
    expect(users.length, "no rule uses a spring, so there is nothing to check").toBeGreaterThan(0);
    for (const r of users) {
      const times = ms(r.body.replace(/linear\([^)]*\)/g, ""));
      expect(times.length, `${r.selector} names no duration`).toBeGreaterThan(0);
      for (const t of times) expect(t, `${r.selector} runs ${t}ms`).toBeLessThanOrEqual(300);
    }
  });

  it("uses no `transition: all`", () => {
    expect(users.length, "no rule uses a spring, so there is nothing to check").toBeGreaterThan(0);
    for (const r of users) expect(r.body, r.selector).not.toMatch(/transition[^;]*\ball\b/);
  });

  it("spends the soft spring on the dialog/popover open and the sheet open", () => {
    const sel = users.filter((r) => r.body.includes(`var(${SOFT})`)).map((r) => r.selector);
    expect(sel).toEqual(expect.arrayContaining([".animate-fade-in-scale", ".animate-fadeSlideUp"]));
  });

  it("presses with scale(0.97) inside prefers-reduced-motion: no-preference, on the snap spring", () => {
    const press = ALL_RULES.filter((r) => r.selector === ".press-spring:active");
    expect(press).toHaveLength(1);
    expect(press[0].body.replace(/\s+/g, " ")).toMatch(/transform:\s*scale\(0\.97\)/);
    expect(press[0].within.join(" ")).toMatch(/prefers-reduced-motion:\s*no-preference/);
    const base = ALL_RULES.find((r) => r.selector === ".press-spring" && r.within.length === 0);
    expect(base?.body).toMatch(new RegExp(`transform\\s+var\\(--motion-micro\\)\\s+var\\(${SNAP}\\)`));
  });
});

describe("the press feedback has callers", () => {
  it("is on the bottom tab bar tabs and on the More sheet rows", () => {
    const tabs = read("components/layout/bottom-tab-bar.tsx");
    expect((tabs.match(/press-spring/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const more = read("components/layout/more-sheet.tsx");
    expect((more.match(/press-spring/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("press motion lives only where motion is allowed (review round 2, items 4 and 9)", () => {
  const styleFiles = ["app/styles/base.css", "app/styles/effects.css", "app/styles/tokens.css"];
  const allRules = styleFiles.flatMap((f) => rules(stripComments(read(f))).map((r) => ({ ...r, file: f })));

  it("no :active rule sets a transform outside a prefers-reduced-motion: no-preference block", () => {
    const bad = allRules
      .filter((r) => /:active\b/.test(r.selector) && /(^|[\s;])transform\s*:/.test(r.body))
      .filter((r) => !r.within.some((w) => /prefers-reduced-motion:\s*no-preference/.test(w)))
      .map((r) => `${r.file} ${r.selector}`);
    expect(bad).toEqual([]);
  });

  it("the generic button press still exists, inside the no-preference block", () => {
    const press = allRules.filter((r) => /button:active/.test(r.selector) && /transform\s*:\s*scale\(0\.97\)/.test(r.body));
    expect(press).toHaveLength(1);
    expect(press[0].within.join(" ")).toMatch(/prefers-reduced-motion:\s*no-preference/);
  });

  it("a spring user never hides its duration behind calc()", () => {
    const users = allRules.filter((r) => r.body.includes(`var(${SOFT})`) || r.body.includes(`var(${SNAP})`));
    expect(users.length).toBeGreaterThan(0);
    for (const r of users) expect(r.body, `${r.selector} uses calc() in a motion declaration`).not.toMatch(/calc\(/);
  });

  it("press-spring is counted in JSX class strings only, never in a comment", () => {
    const inClassStrings = (src: string) => {
      const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      return (code.match(/["'`][^"'`\n]*\bpress-spring\b[^"'`\n]*["'`]/g) ?? []).length;
    };
    expect(inClassStrings("// press-spring in a comment\nconst a = 1; {/* press-spring */}")).toBe(0);
    expect(inClassStrings('className="x press-spring"')).toBe(1);
    expect(inClassStrings(read("components/layout/bottom-tab-bar.tsx"))).toBeGreaterThanOrEqual(2);
    expect(inClassStrings(read("components/layout/more-sheet.tsx"))).toBeGreaterThanOrEqual(1);
  });
});
