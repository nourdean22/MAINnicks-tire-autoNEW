/**
 * A 0–1 score is never compared to a 0–100 threshold (2026-09-16, W8).
 *
 * `power-dynamics.ts` filtered `trustScore < 50` on a field the schema
 * declares `Float @default(0.5) // 0-1` (prod 2026-09-16: min 0.3, max 0.9,
 * mean 0.585). The comparison was VACUOUSLY TRUE for every person who has
 * ever existed, so the "unstable alliances" list silently included the
 * operator's highest-trust allies whenever the other half of the filter let
 * them through. Nothing failed: no crash, no type error, no empty result —
 * just a wrong list handed to the model.
 *
 * That is the defect class this scan closes. It is deliberately narrow: it
 * checks the 0–1 score fields by name against numeric literals above 1, which
 * is the exact mistake, and nothing broader (a `length > 50` or a percentage
 * derived with `* 100` is fine and common).
 *
 * Positive control: restoring `p.trustScore < 50` in
 * `lib/brain/analyzers/power-dynamics.ts` turns this RED, naming the file,
 * the field and the literal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/**
 * Comments are not code. The first cut of this scan flagged its own
 * explanation of the bug ("`trustScore < 50` — trustScore is a 0–1 Float"),
 * which would have made every future fix un-documentable. Strip comments and
 * string literals before matching.
 */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Fields the Prisma schema declares on a 0–1 scale. */
const UNIT_SCALE_FIELDS = ["trustScore", "powerBalance", "confidence"] as const;

/** `<field> <op> <number>` where the number is > 1 — e.g. `trustScore < 50`. */
function violations(rawSrc: string): string[] {
  const src = stripNonCode(rawSrc);
  const out: string[] = [];
  for (const field of UNIT_SCALE_FIELDS) {
    const re = new RegExp(`\\b${field}\\b\\s*(<=|>=|<|>|===|!==|==)\\s*(\\d+(?:\\.\\d+)?)`, "g");
    for (const m of src.matchAll(re)) {
      if (Number(m[2]) > 1) out.push(`${field} ${m[1]} ${m[2]}`);
    }
  }
  return out;
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "app", "lib", "components"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

describe("0–1 score fields are never compared to a 0–100 threshold", () => {
  it("no source file compares a unit-scale score to a literal above 1", () => {
    const found: string[] = [];
    for (const file of trackedFiles()) {
      for (const v of violations(readFileSync(join(ROOT, file), "utf8"))) {
        found.push(`${file}: ${v}`);
      }
    }
    expect(
      found,
      `these comparisons mix a 0–1 score with a 0–100 threshold — the condition is vacuously true (or false) and nothing else fails:\n${found.join("\n")}`,
    ).toEqual([]);
  });

  it("the detector fires on the exact shape that shipped (instrument control)", () => {
    expect(violations("const bad = profiles.filter((p) => p.trustScore < 50);")).toEqual(["trustScore < 50"]);
    expect(violations("if (p.powerBalance >= 40) {}")).toEqual(["powerBalance >= 40"]);
  });

  it("the detector does not fire on comments or prose describing the bug", () => {
    expect(violations("// the old filter was trustScore < 50, vacuously true")).toEqual([]);
    expect(violations("/* trustScore < 50 was the defect */")).toEqual([]);
    expect(violations('const msg = "trustScore < 50";')).toEqual([]);
  });

  it("the detector does not fire on correct unit-scale comparisons", () => {
    expect(violations("if (p.trustScore < 0.4) {}")).toEqual([]);
    expect(violations("if (p.trustScore >= 0.7) {}")).toEqual([]);
    expect(violations("if (rows.length > 50) {}")).toEqual([]);
    expect(violations("const pct = Math.round(p.trustScore * 100);")).toEqual([]);
  });
});
