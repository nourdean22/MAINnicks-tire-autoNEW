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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Source without comments, so prose that names a removed pattern cannot satisfy or fail a check. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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

describe("09-F17 · no dead focus utility the unlayered :focus-visible rule overrides", () => {
  // Owned by sibling tasks in the 2026-10-10 repair wave; they carry the same dead utilities and
  // are cleaned there. Remove an entry once its file is clean.
  const OWNED_ELSEWHERE = new Set([
    "components/home/brief-lead.tsx",
    "components/home/nick-command-line.tsx",
    "features/chat-v2/components/chat-composer.tsx",
  ]);

  it("no .tsx carries focus-visible:outline-gold or focus-visible:shadow-none", () => {
    const offenders = SOURCE_FILES.filter((f) => f.endsWith(".tsx") && !OWNED_ELSEWHERE.has(f)).filter((f) =>
      /focus-visible:(outline-gold|shadow-none)/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("09-F16 · scrolling tab rows leave room for the 4px focus ring", () => {
  it("every overflow-x-auto row in PageTabs has vertical padding, and no tab is pulled into the clip edge", () => {
    const tabs = code("components/layout/page-tabs.tsx");
    const scrollers = [...tabs.matchAll(/"[^"\n]*overflow-x-auto[^"\n]*"/g)].map((m) => m[0]);
    expect(scrollers.length, "the scan found no scrolling rows").toBe(3);
    for (const cls of scrollers) expect(cls, cls).toMatch(/\bpy-1\b/);
    expect(tabs).not.toContain("-mb-px");
  });
});

describe("09-F13 · JS smooth scrolls respect prefers-reduced-motion", () => {
  // The chat island is owned by the chat task of the 2026-10-10 repair wave.
  const OWNED_ELSEWHERE = new Set(["features/chat-v2/components/chat-island.tsx"]);

  it("no smooth-scroll literal outside the shared scrollBehavior() helper", () => {
    const offenders = SOURCE_FILES.filter((f) => !OWNED_ELSEWHERE.has(f)).filter((f) =>
      /behavior:\s*["']smooth["']/.test(code(f)),
    );
    expect(offenders).toEqual([]);
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
