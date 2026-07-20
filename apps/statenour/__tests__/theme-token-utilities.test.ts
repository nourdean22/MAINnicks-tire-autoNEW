/**
 * 2026-07-20 · Tailwind v4 colour utilities must reference REGISTERED theme tokens.
 *
 * THE LIVE DEFECT THIS PINS. The weekday picker in the task edit sheet looked
 * completely dead — tapping Sun..Sat produced no visible change, so a
 * `weekly · specific days` task could not be configured at all. The click
 * handler was fine. The STYLING was the bug:
 *
 *   on  ? "border-primary bg-primary/15 text-primary"
 *       : "border-border text-muted-foreground hover:border-primary/50"
 *
 * This app is Tailwind v4. A colour utility only exists if its token is
 * registered in the `@theme inline` bridge in app/styles/tokens.css. A bare
 * `--primary:` custom property in :root does NOT create `bg-primary`. So all of
 * those classes emitted zero CSS and the selected button rendered identical to
 * the unselected one — invisible state, and a second tap silently toggled the
 * day back off so saving failed with "Pick at least one weekday".
 *
 * This test reads the ACTUAL bridge rather than hardcoding a token list, so it
 * stays correct when tokens are added or renamed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

/** Colour tokens the @theme bridge actually registers (`--color-x` -> `x`). */
function registeredColorTokens(): Set<string> {
  const css = readFileSync(join(ROOT, "app/styles/tokens.css"), "utf8");
  const theme = css.slice(css.indexOf("@theme"));
  return new Set(
    [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );
}

/**
 * Strip comments before scanning. The fix for this very bug documents the old
 * broken class names in a comment, and an earlier version of this test flagged
 * those — a guard that cannot tell code from prose is not a guard.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Bare colour utilities used in a file, ignoring arbitrary values like text-[var(--x)]. */
function bareColorUtilities(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(?:^|["'\s`])(bg|text|border)-([a-z][a-z0-9-]*)(?:\/\d+)?(?=["'\s`])/g)) {
    found.push(`${m[1]}-${m[2]}`);
  }
  return found;
}

/** Utilities that are Tailwind built-ins, not theme colours — never token-backed. */
const NON_COLOR = new Set([
  // border-width / style, text-size / align / weight / transform, bg-repeat etc.
  "border-0", "border-2", "border-4", "border-8", "border-t", "border-b",
  "border-l", "border-r", "border-x", "border-y", "border-solid", "border-dashed",
  "border-none", "border-collapse", "border-separate",
  "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-left",
  "text-center", "text-right", "text-justify", "text-wrap", "text-nowrap",
  "text-balance", "text-pretty", "text-ellipsis", "text-clip", "text-start", "text-end",
  "bg-cover", "bg-contain", "bg-center", "bg-no", "bg-fixed", "bg-local",
  "bg-scroll", "bg-clip", "bg-origin", "bg-blend", "bg-gradient", "bg-none",
  "bg-transparent", "bg-current", "bg-inherit", "text-transparent", "text-current",
  "text-inherit", "border-transparent", "border-current", "border-inherit",
]);

/**
 * Tokens the shipped UI actually depends on. Measured 2026-07-20 from bare
 * (non-arbitrary) utility usage across components/ + app/. Every one was
 * authored in :root but MISSING from the @theme bridge, so the utilities
 * emitted nothing — that is what made the weekday picker invisible (#972).
 */
const REQUIRED_TOKENS: Array<[string, number]> = [
  ["muted-foreground", 13], ["primary", 12], ["foreground", 11], ["border", 8],
  ["muted", 6], ["destructive", 6], ["input", 5], ["background", 4],
  ["popover-foreground", 4], ["ring", 3], ["primary-foreground", 2],
  ["secondary", 2], ["secondary-foreground", 2], ["card", 1],
  ["card-foreground", 1], ["accent", 1], ["accent-foreground", 1], ["popover", 1],
];

describe("task-edit-sheet weekday picker · theme tokens", () => {
  const tokens = registeredColorTokens();

  it("the @theme bridge is readable and non-empty", () => {
    expect(tokens.size).toBeGreaterThan(5);
    expect(tokens.has("gold")).toBe(true);
  });

  // Un-registering any of these silently un-styles real components: the
  // utility stops emitting CSS with no error, no warning and no visual clue.
  it.each(REQUIRED_TOKENS)("registers %s (used by %i file(s))", (token) => {
    expect(
      tokens.has(token as string),
      `--color-${token} is missing from the @theme bridge in app/styles/tokens.css. ` +
      `Utilities like bg-${token} / text-${token} will emit NO css and render invisibly.`,
    ).toBe(true);
  });

  // THE regression: `primary` was never registered, which is why the picker
  // was invisible. If someone adds it later this test simply stops flagging it.
  it("every bare colour utility in the weekday picker resolves to a registered token", () => {
    const src = readFileSync(join(ROOT, "components/missions/task-edit-sheet.tsx"), "utf8");
    // The picker block only — keeps the assertion tight and the failure readable.
    const start = src.indexOf("on which days?");
    expect(start).toBeGreaterThan(-1);
    const block = stripComments(src.slice(start, start + 3000));

    const unresolved = [...new Set(bareColorUtilities(block))].filter((u) => {
      if (NON_COLOR.has(u)) return false;
      if (u === "border") return false; // bare width utility
      const token = u.replace(/^(bg|text|border)-/, "");
      // Tailwind palette colours (slate-500 etc.) are built in; theme tokens are not.
      if (/^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d+)?$/.test(token)) return false;
      return !tokens.has(token);
    });

    expect(unresolved, `unregistered colour utilities (emit NO css, render invisible): ${unresolved.join(", ")}`).toEqual([]);
  });
});
