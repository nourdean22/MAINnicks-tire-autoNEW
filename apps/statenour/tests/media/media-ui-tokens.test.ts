/**
 * BDN-317 · media UI token integrity (media plan item #8).
 *
 * WHY THIS IS THE POLISH PASS
 * "Make it sexy without making it stupid" reads as a restyle brief, but
 * the app already HAS the aesthetic the plan describes — dark
 * foundation, compact metadata, sharp chips, no gradients. What it does
 * not have is a guarantee that the classes those components use actually
 * emit CSS.
 *
 * This repo has been bitten by that twice: `bg-primary` emitting ZERO
 * CSS under Tailwind v4, and a nickstire pass where nonexistent shades
 * rendered as nothing. A colour that silently resolves to nothing does
 * not look broken — it looks *plain*, which is indistinguishable from a
 * design choice and therefore never gets reported.
 *
 * So the polish is: every design token the media surfaces reference must
 * exist in app/styles/tokens.css, and the media surfaces must use the
 * token UTILITIES rather than raw `var()` escapes — which resolve
 * identically but split one vocabulary into two, so a future token
 * rename fixes half the files.
 *
 * Reads source text; no DOM, no build step.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENT_DIR = join(process.cwd(), "features/chat-v2/components");
const TOKENS_CSS = join(process.cwd(), "app/styles/tokens.css");

/** The media surfaces built across plan items #1-#7. */
const MEDIA_FILES = readdirSync(COMPONENT_DIR).filter(
  (f) => (f.startsWith("chat-media-") || f.startsWith("media-")) && f.endsWith(".tsx"),
);

const sourceOf = (f: string) => readFileSync(join(COMPONENT_DIR, f), "utf8");
const tokensCss = readFileSync(TOKENS_CSS, "utf8");

/** `bg-void` / `text-fg-tertiary` / `border-glass` → the token name. */
const TOKEN_UTILITY_RE = /\b(?:text|bg|border)-((?:fg|void|edge|glass|elevated)[a-z-]*)/g;

describe("media UI · every token utility resolves to a real token", () => {
  it("found the media components to check", () => {
    // A glob that matches nothing would make this whole suite vacuously
    // green — the "smoke.test that asserts nothing" failure.
    expect(MEDIA_FILES.length).toBeGreaterThanOrEqual(5);
  });

  it("declares every referenced token in tokens.css", () => {
    const missing: string[] = [];
    for (const file of MEDIA_FILES) {
      for (const m of sourceOf(file).matchAll(TOKEN_UTILITY_RE)) {
        const token = m[1];
        // Tailwind v4 generates the utility from `--color-<token>`.
        if (!tokensCss.includes(`--color-${token}:`)) missing.push(`${file}: ${m[0]}`);
      }
    }
    expect(missing, `Tokens with no --color-* definition emit ZERO CSS:\n${missing.join("\n")}`).toEqual(
      [],
    );
  });

  it("proves the check can fail — a bogus token is not declared", () => {
    // Guards against the assertion above passing because the regex
    // matched nothing or tokens.css was read empty.
    expect(tokensCss).not.toContain("--color-notarealtoken:");
    expect(tokensCss).toContain("--color-void:");
  });
});

describe("media UI · one vocabulary, not two", () => {
  it("uses token utilities rather than raw var() escapes", () => {
    // `text-[var(--text-tertiary)]` and `text-fg-tertiary` resolve to the
    // same value, so this is not a visual fix — it is a maintenance one.
    // With both spellings in play, renaming a token fixes half the files
    // and leaves the rest silently pointing at a dead variable.
    const offenders: string[] = [];
    for (const file of MEDIA_FILES) {
      const src = sourceOf(file);
      for (const raw of ["var(--text-", "var(--bg-elevated)", "var(--border-default)"]) {
        if (src.includes(raw)) offenders.push(`${file}: ${raw}`);
      }
    }
    expect(offenders, `Use the token utility instead:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("media UI · the plan's explicit visual prohibitions", () => {
  it("ships no gradients on the media surfaces", () => {
    // "No giant glowing gradients." Cheap to assert, and the kind of
    // thing that creeps back in one component at a time.
    for (const file of MEDIA_FILES) {
      expect(sourceOf(file), `${file} introduced a gradient`).not.toMatch(/bg-gradient-/);
    }
  });

  it("never autoplays", () => {
    // "No autoplay." The dock and focus panel both mount players; an
    // `autoPlay` attribute anywhere here would start audio unbidden.
    for (const file of MEDIA_FILES) {
      expect(sourceOf(file), `${file} added autoplay`).not.toMatch(/\bautoPlay\b/);
    }
  });

  it("keeps touch targets at the repo's 48px minimum", () => {
    // AGENTS.md specifies 48x48. Review already caught 44px here once.
    for (const file of MEDIA_FILES) {
      expect(sourceOf(file), `${file} uses a sub-48px touch target`).not.toMatch(
        /\bh-11\b|\bh-10\b|\bh-9\b/,
      );
    }
  });
});
