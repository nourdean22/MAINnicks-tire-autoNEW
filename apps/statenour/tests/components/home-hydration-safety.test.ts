/**
 * Home · SSR/client render-parity lock · 2026-07-26.
 *
 * Why this exists: CognitivePartner gated its morning-brief chip on a LAZY
 * useState initializer that read localStorage, carrying a comment that
 * described the bug as the design — "SSR renders false; the client's first
 * render reads the day stamp". React requires the client's FIRST render to
 * match the server's, so that branch made the server emit a <div> where the
 * client emitted the brief <button>, and React discarded and re-rendered the
 * entire Home tree on every visit.
 *
 * It survived because nothing was watching: the e2e console-error assertion
 * that catches it could not report while the suite was crashing on an OOM
 * (fixed in PR #1098). This file is the fast local guard so the next one is
 * caught before CI.
 *
 * Source-side per the house precedent (mobile-a11y.test.tsx,
 * level-up-directive-card.test.ts): the vitest env is Node with no jsdom, and
 * these components need the tRPC + chat contexts, so their render contracts
 * are locked against the source text.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOME_DIR = path.join(REPO_ROOT, "components/home");

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf-8");

/**
 * Reduces a component's source to the text that actually executes during
 * render. Removed: import statements (a name being imported says nothing
 * about when it runs) and the bodies of useEffect / useCallback (effects run
 * after commit, callbacks only when invoked). useMemo is deliberately KEPT —
 * it does run during render, so a browser-only read there is a real mismatch.
 * Crude paren matching is sufficient: we only need to know whether the
 * remaining text still touches a browser-only global.
 */
function renderPathOf(src: string): string {
  const withoutImports = src.replace(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
  return ["useEffect(", "useCallback("].reduce(stripCallBodies, withoutImports);
}

function stripCallBodies(src: string, callee: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf(callee, i);
    if (start === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, start);
    let depth = 0;
    let j = start + callee.length - 1;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

describe("Home · the first client render must match the server render", () => {
  it("CognitivePartner reads the brief day-stamp in an effect, never in a useState initializer", () => {
    const src = read("components/home/cognitive-partner.tsx");

    // The state must start from an SSR-reachable constant.
    expect(src).toMatch(/useState\(false\)/);

    // The localStorage-backed helpers must not appear on the render path.
    const renderPath = renderPathOf(src);
    for (const helper of ["readBriefStamp", "shouldFireBrief"]) {
      expect(
        renderPath.includes(helper),
        `${helper}() runs during render — the server cannot reach localStorage, so the client's first render will diverge and React will re-render all of Home`,
      ).toBe(false);
    }
  });

  it("no Home component branches on a browser-only global during render", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(HOME_DIR).filter((f) => f.endsWith(".tsx"))) {
      const renderPath = renderPathOf(readFileSync(path.join(HOME_DIR, file), "utf-8"));
      // A lazy initializer that consults localStorage / window is the exact
      // shape that produced the 2026-07-26 mismatch.
      if (/useState\((?:\(\)|function)[^)]*=>\s*\{[\s\S]{0,400}?(localStorage|sessionStorage|typeof window)/.test(renderPath)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `these Home components read a browser-only global inside a useState initializer; move it into a useEffect: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
