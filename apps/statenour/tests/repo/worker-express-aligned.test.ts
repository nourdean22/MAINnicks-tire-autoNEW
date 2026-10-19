/**
 * The worker's `express` and `@types/express` must stay on the same major, and that major is 5.
 *
 * Why a test: the lockfile already holds express@4 (nickstire) and express@5 (a transitive
 * dependency) but only @types/express@4, so bumping one of the two declarations and forgetting
 * the other installs cleanly and then type-checks against the wrong API. Express 5 changed the
 * `app.listen` callback contract (see worker-listen-error.test.ts); the types must describe it.
 *
 * Reads apps/worker/package.json only. Lockfile consistency is CI's frozen install, not this test.
 * nickstire stays on Express 4 until its own job, so nothing here looks at it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** `^5.2.1`, `~5.0`, `>=5`, `5.x`, `5` -> 5. Anything else (`workspace:*`, `latest`, `*`) -> null. */
function majorOf(range: string | undefined): number | null {
  const m = /^[\^~>=\s]*(\d+)(?:\.|$)/.exec(range ?? "");
  return m ? Number(m[1]) : null;
}

/** Empty means aligned on 5. A missing or unparsable entry is a problem, never a pass. */
function alignmentProblems(pkg: Manifest): string[] {
  const runtime = pkg.dependencies?.["express"];
  const types = pkg.devDependencies?.["@types/express"];
  const problems: string[] = [];
  const rMajor = majorOf(runtime);
  const tMajor = majorOf(types);
  if (rMajor === null) problems.push(`express range unreadable: ${JSON.stringify(runtime)}`);
  if (tMajor === null) problems.push(`@types/express range unreadable: ${JSON.stringify(types)}`);
  if (rMajor !== null && tMajor !== null && rMajor !== tMajor) {
    problems.push(`express major ${rMajor} != @types/express major ${tMajor}`);
  }
  if (rMajor !== null && rMajor !== 5) problems.push(`express major is ${rMajor}, expected 5`);
  if (tMajor !== null && tMajor !== 5) problems.push(`@types/express major is ${tMajor}, expected 5`);
  return problems;
}

const real: Manifest = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "apps/worker/package.json"), "utf8"),
);
const plant = (patch: { express?: string; types?: string }): Manifest => ({
  dependencies: { ...real.dependencies, ...(patch.express ? { express: patch.express } : {}) },
  devDependencies: {
    ...real.devDependencies,
    ...(patch.types ? { "@types/express": patch.types } : {}),
  },
});

describe("worker express / @types/express alignment", () => {
  it("apps/worker/package.json declares both on major 5", () => {
    expect(alignmentProblems(real)).toEqual([]);
  });

  // Positive controls: the detector must fire on a planted copy, never on the real file.
  it.each([
    ["@types/express left on 4.x", { types: "^4.17.21" }],
    ["express left on 4.x", { express: "^4.21.2" }],
    ["both on 4.x (the pre-bump tree)", { express: "^4.21.2", types: "^4.17.21" }],
    ["both on 6", { express: "^6.0.0", types: "^6.0.0" }],
    ["@types/express unpinned", { types: "latest" }],
  ])("the detector fires when %s", (_label, patch) => {
    expect(alignmentProblems(plant(patch)).length).toBeGreaterThan(0);
  });

  it("the detector fires when an entry is missing", () => {
    const noTypes: Manifest = {
      dependencies: { ...real.dependencies },
      devDependencies: Object.fromEntries(
        Object.entries(real.devDependencies ?? {}).filter(([k]) => k !== "@types/express"),
      ),
    };
    expect(alignmentProblems(noTypes).length).toBeGreaterThan(0);
  });

  it("the detector stays quiet on a correct planted copy", () => {
    expect(alignmentProblems(plant({ express: "^5.2.1", types: "^5.0.0" }))).toEqual([]);
    expect(alignmentProblems(plant({ express: "~5.1.0", types: "5" }))).toEqual([]);
  });
});
