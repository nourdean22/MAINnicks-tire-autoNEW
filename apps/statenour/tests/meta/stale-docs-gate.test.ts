/**
 * tests/meta/stale-docs-gate.test.ts · de-Venice control-plane lock.
 *
 * Locks that the stale-docs guard stays wired into BOTH gates so doc
 * drift (e.g. lingering Venice references in runbooks/audits) can't
 * merge silently. Pure fs reads — no mocks.
 *
 * Two halves:
 *   1. package.json — `verify:hard` must invoke `check:stale-docs` in
 *      strict mode (STALE_DOCS_STRICT=1), and the script must exist.
 *   2. CI workflow — the repo-root .github/workflows/test.yml must carry
 *      a statenour-scoped stale-doc guard step (`@statenour/web
 *      check:stale-docs` gated on the statenour change filter, with
 *      STALE_DOCS_STRICT), alongside the Turbo --affected pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// __dirname = apps/statenour/tests/meta -> STATENOUR_ROOT = apps/statenour,
// REPO_ROOT = the worktree/repo root that holds .github/.
const STATENOUR_ROOT = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(STATENOUR_ROOT, "..", "..");

function read(rel: string, from = STATENOUR_ROOT): string {
  return readFileSync(path.resolve(from, rel), "utf-8");
}

describe("stale-docs gate · package.json wiring", () => {
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
  };

  it("verify:hard invokes check:stale-docs", () => {
    expect(pkg.scripts["verify:hard"]).toBeTypeOf("string");
    expect(pkg.scripts["verify:hard"]).toContain("check:stale-docs");
  });

  it("verify:hard runs the stale-docs check in strict mode", () => {
    expect(pkg.scripts["verify:hard"]).toMatch(/STALE_DOCS_STRICT=1/);
  });

  it("the check:stale-docs script exists and points at the checker", () => {
    expect(pkg.scripts["check:stale-docs"]).toBeTypeOf("string");
    expect(pkg.scripts["check:stale-docs"]).toMatch(/check-stale-docs/);
  });
});

describe("stale-docs gate · CI workflow", () => {
  const workflow = read(".github/workflows/test.yml", REPO_ROOT);

  it("runs the Turbo affected verify pipeline", () => {
    expect(workflow.length).toBeGreaterThan(0);
    expect(workflow).toMatch(/turbo run check lint test build --affected/);
  });

  it("has a dedicated statenour stale-doc guard step (strict)", () => {
    expect(workflow).toMatch(/@statenour\/web check:stale-docs/);
    expect(workflow).toMatch(/STALE_DOCS_STRICT/);
    expect(workflow).toMatch(/steps\.changes\.outputs\.statenour/);
  });
});
