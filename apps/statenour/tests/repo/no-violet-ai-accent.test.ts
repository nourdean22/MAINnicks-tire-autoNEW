/**
 * tests/repo/no-violet-ai-accent.test.ts · 2026-09-08 (program §5.2 / D19)
 *
 * AI attribution is a mono "NICK ·" mark, not a hue. The violet "sparkle"
 * accent was retired from the journal's AI surfaces and the `--status-ai`
 * token (plus its `--status-purple` alias) was deleted. This gate pins
 * the SUBJECT: the exact files that carried the accent, and the token
 * lines that fed it. Categorical palettes (journal entry-kind pills,
 * memory-calibration categories, section-header variants, goal boards)
 * are semantics, not AI attribution — deliberately NOT in scope.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const AI_SURFACES = [
  "components/journal/journal-insights-preview.tsx",
  "components/journal/reflect-composer.tsx",
  "components/journal/entry-row.tsx",
];

describe("no violet AI accent", () => {
  for (const file of AI_SURFACES) {
    it(`${file} carries no violet class`, () => {
      const hits = read(file).match(/violet-\d{3}/g) ?? [];
      expect(hits, `${file}: ${hits.join(", ")}`).toEqual([]);
    });
  }

  it("the AI attribution mark is present where the accent used to be", () => {
    expect(read("components/journal/journal-insights-preview.tsx")).toContain("NICK ·");
    expect(read("components/journal/reflect-composer.tsx")).toContain("NICK · ");
  });

  it("--status-ai and --status-purple are gone from tokens.css", () => {
    const tokens = read("app/styles/tokens.css");
    expect(tokens).not.toMatch(/^\s*--status-ai:/m);
    expect(tokens).not.toMatch(/^\s*--status-purple:/m);
  });

  it("effects.css neither references the retired tokens nor hard-codes the violet", () => {
    const css = read("app/styles/effects.css");
    expect(css).not.toMatch(/var\(--status-(ai|purple)\)/);
    expect(css).not.toContain("168, 85, 247");
  });

  it("nothing else references the retired tokens (a consumer of a deleted token renders transparent)", () => {
    // Bounded scan: every .css/.tsx/.ts under app/, components/, lib/.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync('git grep -n -e "--status-ai" -e "--status-purple" -- app components lib || true', {
      cwd: ROOT,
      encoding: "utf8",
    });
    const offenders = out
      .split("\n")
      .filter((l) => l.trim().length > 0)
      // the tokens.css retirement note may mention the names in a comment
      .filter((l) => !l.startsWith("app/styles/tokens.css"));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
