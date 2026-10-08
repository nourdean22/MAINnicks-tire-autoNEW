/**
 * No kill-rule alternative opens with a variable-width lookbehind (2026-10-08).
 *
 * V8 tries a lookbehind that leads an alternative at EVERY position of the text,
 * before it looks at the literal that follows. Two such alternatives, the
 * financing window in claim.approval-promise and the E-Check window in
 * claim.echeck-pass-guarantee (both `[^.\n]{0,80}`), made the claim scan in
 * canonical-business-truth.test.ts take 52 s on a cloud container against its
 * 30 s timeout, and they run on every copy check in production as well.
 *
 * The fix puts the literal first, as a lookahead: `(?=\bget )(?<=…)\bget …`.
 * Lookarounds at one position commute, and the rest of the alternative starts
 * with that literal, so the matches are the same; only the order of the checks
 * changes. Proven before the change: 2,191,382 comparisons over every line and
 * file of client/src, shared, server, docs and the workspace packages, 0 diffs.
 */
import { describe, expect, it } from "vitest";
import { KILL_RULES } from "./voice";

/** The top-level alternatives of a regex source. */
function topLevelAlternatives(source: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inClass = false;
  let current = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      current += c + (source[i + 1] ?? "");
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      current += c;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "|" && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  out.push(current);
  return out;
}

/** The lookbehind an alternative opens with, when it can span more than a fixed few characters; else null. */
function wideLeadingLookbehind(alternative: string): string | null {
  if (!alternative.startsWith("(?<=") && !alternative.startsWith("(?<!")) return null;
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < alternative.length; i++) {
    const c = alternative[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) {
      const group = alternative.slice(0, i + 1);
      return /[*+]|\{\d*,\d*\}/.test(group) ? group : null;
    }
  }
  return null;
}

describe("kill-rule patterns stay linear on long copy", () => {
  it("no alternative opens with a variable-width lookbehind (put a literal lookahead in front of it)", () => {
    const offenders = KILL_RULES.flatMap((rule) =>
      topLevelAlternatives(rule.pattern.source)
        .map((alt, i) => ({ rule: rule.id, alt: i, lookbehind: wideLeadingLookbehind(alt) }))
        .filter((o) => o.lookbehind),
    );
    expect(offenders).toEqual([]);
  });

  it("CONTROL: the shape that cost 52 s is caught; a short fixed lookbehind and a literal-led one are not", () => {
    expect(wideLeadingLookbehind(String.raw`(?<=\b(?:e-?check|emissions)\b[^\n]{0,80})\bget (?:you|it) legal\b`)).not.toBeNull();
    expect(wideLeadingLookbehind(String.raw`(?<=\bfinanc\w*\b)\bapproved\b`)).not.toBeNull();
    expect(wideLeadingLookbehind(String.raw`(?<!\bASE[- ])\bcertified\b`)).toBeNull();
    expect(wideLeadingLookbehind(String.raw`(?=\bget )(?<=\b(?:e-?check|emissions)\b[^\n]{0,80})\bget (?:you|it) legal\b`)).toBeNull();
    // and the splitter sees through groups and classes
    expect(topLevelAlternatives(String.raw`a(?:b|c)|[|]d|e`)).toEqual(["a(?:b|c)", "[|]d", "e"]);
  });
});
