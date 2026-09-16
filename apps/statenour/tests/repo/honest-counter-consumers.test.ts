/**
 * `interactionCount` is no longer a ranking signal, and no trigger may name a
 * threshold it cannot reach (2026-09-16, W8).
 *
 * BACKGROUND. Until the 2026-09-16 counter reconcile, `interactionCount` was
 * inflated: a chat message that merely NAMED a person bumped it, so the column
 * ran to 69 and behaved like a plausible "how well do I know them" score.
 * Every consumer was written against that. With honest counters the live
 * distribution is:
 *
 *   20 live profiles · 7 ever logged · 13 at zero · maximum 4
 *
 * Two defect shapes follow, and this file closes both.
 *
 * 1 · ORDERING. `orderBy: { interactionCount: "desc" }` used to sort people
 *   meaningfully. Now it is an arbitrary tie-break over 13 identical zeros —
 *   the top-N it feeds to the model is effectively random. Recency still
 *   discriminates, so it must lead. This scan fails on any `personProfile`
 *   read whose FIRST order key is `interactionCount`.
 *
 * 2 · THRESHOLD. Greene law_16 shipped the trigger `"interactionCount > 20 in
 *   the last 60 days"`. Those strings are read by an LLM applicability check,
 *   so they are instructions — and a threshold the data cannot reach is not a
 *   conservative filter, it is a false instruction the model can only satisfy
 *   by hallucinating. This scan fails on any trigger or applicabilityPrompt
 *   naming an `interactionCount` bound above the measured maximum.
 *
 * Positive controls: both detectors are exercised on synthetic inputs below,
 * because a scan that has quietly stopped matching reports an empty offender
 * list exactly like a clean tree does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/**
 * Measured on prod 2026-09-16 (read-only) after the counter reconcile. Update
 * this only by re-measuring, never to make a failing threshold pass.
 */
const MEASURED_MAX_INTERACTION_COUNT = 4;

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "app", "lib", "components"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

/* ------------------------------------------------------------------ 1 */

/**
 * A `personProfile` ordering whose FIRST key is interactionCount. Matches both
 * spellings: the object form `orderBy: { interactionCount: "desc" }` and the
 * array form `orderBy: [{ interactionCount: "desc" }, …]`.
 */
export function countFirstOrderings(src: string): string[] {
  const out: string[] = [];
  const re = /orderBy:\s*(\[\s*)?\{\s*interactionCount\s*:/g;
  for (const m of src.matchAll(re)) out.push(m[0].replace(/\s+/g, " "));
  return out;
}

/* ------------------------------------------------------------------ 2 */

/**
 * Comments are not instructions. The subject here is the PROSE INSIDE THE
 * STRING LITERALS — those are what the applicability check feeds to a model —
 * so this strips comments and keeps strings, the mirror image of
 * `score-scale-mismatch.test.ts`, which strips strings and keeps code.
 *
 * Found by the canary firing on its own fix: the comment recording what law_16
 * used to say quotes `"interactionCount > 20 in the last 60 days"` verbatim,
 * and without this the repair could not be documented beside the code.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** `interactionCount` compared to a literal, anywhere in a prose trigger. */
export function unreachableCountClaims(rawText: string, max = MEASURED_MAX_INTERACTION_COUNT): string[] {
  const text = stripComments(rawText);
  const out: string[] = [];
  const re = /interactionCount\s*(>=|>|===|==)\s*(\d+)/g;
  for (const m of text.matchAll(re)) {
    const n = Number(m[2]);
    const lowestSatisfying = m[1] === ">" ? n + 1 : n;
    if (lowestSatisfying > max) out.push(`${m[1]} ${n}`);
  }
  return out;
}

describe("honest counters · interactionCount is not a ranking signal", () => {
  it("no personProfile read orders by interactionCount FIRST", () => {
    const found: string[] = [];
    for (const file of trackedFiles()) {
      const src = readFileSync(join(ROOT, file), "utf8");
      if (!/personProfile\s*\n?\s*\./.test(src) && !/personProfile\./.test(src)) continue;
      for (const hit of countFirstOrderings(src)) found.push(`${file}: ${hit}`);
    }
    expect(
      found,
      `these order people by a counter whose honest range is 0–${MEASURED_MAX_INTERACTION_COUNT} with 13 of 20 at zero — ` +
        `lead with lastInteraction (nulls last) and let the count break ties:\n${found.join("\n")}`,
    ).toEqual([]);
  });

  it("the ordering detector fires on both spellings (instrument control)", () => {
    expect(countFirstOrderings('orderBy: { interactionCount: "desc" },')).toHaveLength(1);
    expect(countFirstOrderings('orderBy: [{ interactionCount: "desc" }, { trustScore: "desc" }],')).toHaveLength(1);
  });

  it("the ordering detector accepts the repaired shape", () => {
    expect(
      countFirstOrderings(
        'orderBy: [{ lastInteraction: { sort: "desc", nulls: "last" } }, { interactionCount: "desc" }],',
      ),
    ).toEqual([]);
  });
});

describe("honest counters · no Greene trigger names an unreachable count", () => {
  const greene = () => readFileSync(join(ROOT, "lib/brain/greene/48-laws-of-power.ts"), "utf8");

  it("no law's triggers or applicabilityPrompt require a count the ledger cannot produce", () => {
    const found = unreachableCountClaims(greene());
    expect(
      found,
      `these Greene conditions require an interactionCount above the measured maximum of ` +
        `${MEASURED_MAX_INTERACTION_COUNT} — an LLM can only satisfy them by inventing a reading:\n${found.join("\n")}`,
    ).toEqual([]);
  });

  it("the threshold detector fires on the exact string that shipped (instrument control)", () => {
    expect(unreachableCountClaims('"interactionCount > 20 in the last 60 days"')).toEqual(["> 20"]);
    expect(unreachableCountClaims("interactionCount >= 10")).toEqual([">= 10"]);
  });

  it("the threshold detector does not fire on a comment recording the old bug", () => {
    // The repair note beside law_16 quotes the dead trigger verbatim. A
    // detector that flagged its own documentation would make every future fix
    // un-documentable, which is how a control gets deleted instead of fixed.
    expect(unreachableCountClaims('// was "interactionCount > 20 in the last 60 days"')).toEqual([]);
    expect(unreachableCountClaims("/* interactionCount >= 10 was unreachable */")).toEqual([]);
    // …but the same text inside a live trigger string still fires.
    expect(unreachableCountClaims('triggers: ["interactionCount > 20 in the last 60 days"]')).toEqual(["> 20"]);
  });

  it("the threshold detector does not fire on a reachable bound", () => {
    expect(unreachableCountClaims("interactionCount >= 1")).toEqual([]);
    expect(unreachableCountClaims("interactionCount > 3")).toEqual([]);
    // exactly the maximum is reachable; one above it is not
    expect(unreachableCountClaims(`interactionCount >= ${MEASURED_MAX_INTERACTION_COUNT}`)).toEqual([]);
    expect(unreachableCountClaims(`interactionCount > ${MEASURED_MAX_INTERACTION_COUNT}`)).toEqual([
      `> ${MEASURED_MAX_INTERACTION_COUNT}`,
    ]);
  });

  it("the scan reaches the real file (it is not reading an empty string)", () => {
    // A blind scan and a clean file both report zero offenders.
    expect(greene()).toContain("law_16");
    expect(greene().length).toBeGreaterThan(10_000);
  });
});
