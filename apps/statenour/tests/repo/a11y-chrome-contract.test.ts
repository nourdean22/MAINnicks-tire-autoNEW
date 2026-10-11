/**
 * Layout chrome, overlays, focus and motion contract (audit 09, 2026-10-10).
 *
 * Vitest runs in node (no DOM), so what Base UI does at runtime (focus moves in, is trapped,
 * Escape closes, focus returns) cannot be exercised here. What CAN be pinned is that each
 * overlay is wired to that primitive instead of a hand-rolled div, and that the class strings
 * which decide hit areas, focus-ring room and chrome clearance say what the audit asked for.
 * Each block names the finding it closes; each was red against the pre-fix tree.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextBlockBadges } from "@/components/chat/context-block-badges";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Source without comments, so prose that names a removed pattern cannot satisfy or fail a check. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = (p: string) => strip(read(p));

function walk(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return walk(path, ext);
    return ext.test(name) ? [path] : [];
  });
}
const SOURCE_FILES = ["app", "components", "features", "hooks", "lib"]
  .flatMap((d) => walk(join(ROOT, d), /\.tsx?$/))
  .map((f) => relative(ROOT, f).replaceAll("\\", "/"));

describe("09-F4 · overlays are Base UI dialogs (focus in, trapped, Escape, restored)", () => {
  it("the NICK side pane's phone/tablet sheet is a Dialog that returns focus to its trigger", () => {
    const pane = code("components/mastery/nick-side-pane.tsx");
    expect(pane).toMatch(/from "@\/components\/ui\/dialog"/);
    expect(pane).toContain("<DialogContent");
    expect(pane).toContain("finalFocus=");
    // the hand-rolled scrim that only caught taps is gone
    expect(pane).not.toContain('"fixed inset-0 z-[58] bg-canvas/60 lg:hidden"');
  });

  it("the pulse feed sheet is a Dialog; its hand-rolled Escape listener and click-catcher are gone", () => {
    const ticker = code("components/ultron/bottom-pulse-ticker.tsx");
    expect(ticker).toMatch(/from "@\/components\/ui\/dialog"/);
    expect(ticker).toContain("<DialogContent");
    expect(ticker).toContain("finalFocus=");
    expect(ticker).not.toContain('e.key === "Escape"');
    expect(ticker).not.toContain('"fixed inset-0 z-40"');
  });
});

describe("09-F21 · the pulse strip carries a real 44px phone hit area, so it needs no audit exemption", () => {
  it("the ticker no longer opts out of the target-size audit", () => {
    expect(code("components/ultron/bottom-pulse-ticker.tsx")).not.toContain("data-target-audit");
  });

  it("the e2e target-size audit has no exemption hook left", () => {
    expect(read("tests/e2e/target-size.spec.ts")).not.toContain("data-target-audit");
  });
});

describe("09-F21 (rest): badge toggle, slash rows and the documented target size", () => {
  it("the context-block toggle is a real 44px button that says whether it is open", () => {
    const html = renderToStaticMarkup(createElement(ContextBlockBadges, { blocks: { recall: true, skills: true } }));
    const button = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button, "the toggle did not render").not.toBe("");
    expect(button).toMatch(/\bmin-h-11\b/);
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-expanded="false"');
  });

  it("the home slash-menu rows are not 36px", () => {
    expect(code("components/home/nick-command-line.tsx")).not.toContain("min-h-[36px]");
  });

  /** The phone floor the e2e audit enforces: `inlineLink ? 24 : 44`. */
  const specFloor = () => Number(read("tests/e2e/target-size.spec.ts").match(/inlineLink \? \d+ : (\d+)/)?.[1]);
  /** Every "NxNpx" a doc states. */
  const docSizes = (src: string) => [...src.matchAll(/(\d+)\s*[x\u00d7]\s*(\d+)\s*px/g)].map((m) => [Number(m[1]), Number(m[2])]);

  it.each(["AGENTS.md", "CLAUDE.md"])("%s states the same target size the e2e audit enforces", (doc) => {
    expect(specFloor(), "floor not found in target-size.spec.ts").toBeGreaterThan(0);
    const sizes = docSizes(read(doc));
    expect(sizes.length, `${doc} states no target size`).toBeGreaterThan(0);
    for (const [w, h] of sizes) expect([w, h]).toEqual([specFloor(), specFloor()]);
  });

  it("positive control: the doc scan reads both spellings and a stale number differs from the floor", () => {
    expect(docSizes("two-tap confirms, 48\u00d748px minimum targets")).toEqual([[48, 48]]);
    expect(docSizes("44x44px (floor pinned by tests/e2e/target-size.spec.ts)")).toEqual([[44, 44]]);
    expect(specFloor()).toBe(44);
  });
});

describe("09-F17 · no dead focus utility the unlayered :focus-visible rule overrides", () => {
  // Empty since R3-06 (2026-10-11) cleaned brief-lead and nick-command-line. A new entry needs an owner
  // and a date; the reverse canary below fails once a listed file is clean.
  const OWNED_ELSEWHERE = new Set<string>([]);
  /** Gold outline by name, by arbitrary value (`outline-[var(--gold)]`, `outline-(--gold)`), or the shadow kill. In .ts class constants too. */
  const DEAD_FOCUS = /focus-visible:(outline-gold|shadow-none|outline-\[[^\]\s]*gold|outline-\([^)\s]*gold)/;

  it("no source file carries focus-visible:outline-gold or focus-visible:shadow-none", () => {
    const offenders = SOURCE_FILES.filter((f) => !OWNED_ELSEWHERE.has(f)).filter((f) => DEAD_FOCUS.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("REVERSE CANARY: every OWNED_ELSEWHERE file still carries the utility (delete the entry once clean)", () => {
    const clean = [...OWNED_ELSEWHERE].filter((f) => !DEAD_FOCUS.test(code(f)));
    expect(clean, `clean now, so remove from OWNED_ELSEWHERE:\n  ${clean.join("\n  ")}`).toEqual([]);
  });

  it("positive control: each spelling is caught, a comment naming it is not", () => {
    for (const s of ['"focus-visible:outline-gold"', '"md:focus-visible:outline-gold/50"', '"focus-visible:outline-[var(--gold)]"', '"focus-visible:outline-(--gold)"', '"focus-visible:shadow-none"']) {
      expect(DEAD_FOCUS.test(s), s).toBe(true);
    }
    expect(DEAD_FOCUS.test(strip("// do not use focus-visible:shadow-none: the unlayered rule overrides it\nconst a = 1;"))).toBe(false);
    expect(SOURCE_FILES.some((f) => f.endsWith(".ts")), "the scan reads .ts class constants too").toBe(true);
  });
});

describe("09-F16 · scrolling tab rows leave room for the 4px focus ring", () => {
  it("every overflow-x-auto row in PageTabs has padding on all four sides, and no tab is pulled into the clip edge", () => {
    const tabs = code("components/layout/page-tabs.tsx");
    const scrollers = [...tabs.matchAll(/"[^"\n]*overflow-x-auto[^"\n]*"/g)].map((m) => m[0]);
    expect(scrollers.length, "the scan found no scrolling rows").toBe(3);
    for (const cls of scrollers) {
      expect(cls, cls).toMatch(/\bpy-1\b/);
      // the first and last tab's ring sits in the side padding; -mx-1 keeps the row's text aligned
      expect(cls, cls).toMatch(/\bpx-1\b/);
      expect(cls, cls).toMatch(/(^|[\s"])-mx-1([\s"]|$)/);
    }
    expect(tabs).not.toContain("-mb-px");
  });
});

describe("09-F13 · JS smooth scrolls respect prefers-reduced-motion", () => {
  /**
   * Empty since R3-06 (2026-10-11, P-S7b) moved goal-board and character-sheet to scrollBehavior().
   * A new entry needs an owner and a date; the reverse canary fails once a listed file is clean.
   */
  const KNOWN_LOCAL_TERNARY = new Set<string>([]);

  /**
   * How many `behavior` keys in a file can evaluate to "smooth": read from the syntax tree, so the key may
   * be quoted, the value a string, a backtick, a same-file const, or either branch of `?:`. Comments are
   * not nodes. scrollBehavior() is a call, so it never counts.
   */
  function smoothBehaviors(src: string, file: string): number {
    if (!src.includes("smooth")) return 0;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const consts = new Map<string, ts.Expression>();
    const keys: Array<[ts.Node, ts.Expression]> = [];
    (function walk(n: ts.Node): void {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.getCombinedNodeFlags(n) & ts.NodeFlags.Const) consts.set(n.name.text, n.initializer);
      if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteralLike(n.name)) && n.name.text === "behavior") keys.push([n, n.initializer]);
      if (ts.isShorthandPropertyAssignment(n) && n.name.text === "behavior") keys.push([n, n.name]);
      ts.forEachChild(n, walk);
    })(sf);
    const values = (e: ts.Expression, depth = 0): string[] => {
      while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
      if (ts.isStringLiteralLike(e)) return [e.text];
      if (ts.isConditionalExpression(e)) return [...values(e.whenTrue, depth), ...values(e.whenFalse, depth)];
      if (ts.isIdentifier(e) && consts.has(e.text) && depth < 5) return values(consts.get(e.text)!, depth + 1);
      return [];
    };
    return keys.filter(([, v]) => values(v).includes("smooth")).length;
  }

  it("no smooth-scroll literal outside the shared scrollBehavior() helper", () => {
    const offenders = SOURCE_FILES.filter((f) => !KNOWN_LOCAL_TERNARY.has(f)).filter((f) => smoothBehaviors(read(f), f) > 0);
    expect(offenders).toEqual([]);
  });

  it("REVERSE CANARY: every KNOWN entry still picks smooth itself (delete it once it calls scrollBehavior())", () => {
    const moved = [...KNOWN_LOCAL_TERNARY].filter((f) => smoothBehaviors(read(f), f) === 0);
    expect(moved, `moved to the helper, so remove from KNOWN_LOCAL_TERNARY:\n  ${moved.join("\n  ")}`).toEqual([]);
  });

  it("positive control: every spelling of a smooth behavior counts; the helper, auto and a comment do not", () => {
    const n = (src: string) => smoothBehaviors(src, "x.tsx");
    expect(n('el.scrollTo({ behavior: "smooth" });')).toBe(1);
    expect(n("el.scrollTo({ behavior: `smooth` });")).toBe(1);
    expect(n('el.scrollTo({ "behavior": "smooth", top: 0 });')).toBe(1);
    expect(n('const SMOOTH = "smooth" as const;\nel.scrollTo({ top: 0, behavior: SMOOTH });')).toBe(1);
    expect(n('const behavior = "smooth";\nel.scrollTo({ behavior });')).toBe(1);
    expect(n('el.scrollTo({ behavior: rm ? "auto" : "smooth" });')).toBe(1);
    expect(n("el.scrollIntoView({ behavior: scrollBehavior() });")).toBe(0);
    expect(n('el.scrollTo({ top: 0, behavior: "auto" });')).toBe(0);
    expect(n('// never write behavior: "smooth" here\nconst a = 1;')).toBe(0);
  });
});

describe("09-F27 · the deep-mode nudge clears the bottom chrome and the NICK FAB lane", () => {
  it("is docked above the measured chrome height, not at bottom-4 under the tab bar", () => {
    const nudge = code("components/operator/deep-mode-nudge.tsx");
    expect(nudge).toContain("bottom-[calc(var(--bottom-chrome-h)+0.5rem)]");
    expect(nudge).not.toMatch(/\bbottom-4\b/);
    expect(nudge).toContain("md:right-[calc(var(--nick-fab-lane,0px)_+_1rem)]");
  });
});

describe("09-F18 · Settings has one h1, in sentence case", () => {
  it("the console's domain heading is an h2 under the page's h1", () => {
    expect(code("components/settings/settings-console.tsx")).not.toMatch(/<h1\b/);
  });

  it("the page title is sentence case", () => {
    expect(code("app/(mastery)/settings/page.tsx")).toContain('title="Settings"');
  });
});
