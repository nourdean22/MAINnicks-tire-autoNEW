/**
 * Canaries for the charter-rule-7 citation gate.
 *
 * The gate's whole risk is over-firing: it runs on every PR, and a gate that
 * blocks docs-only work gets disabled by the next frustrated human, at which
 * point it guards nothing. So the negative controls here outnumber the positive
 * ones, and every one of them is a REAL diff shape observed in this repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, citation, dependencyChanges } from "./check-source-citation.mjs";

const CITED_BODY = "Adopted per https://vitest.dev/guide/migration accessed 2026-08-28.";

const ADD_DEP = [
  "diff --git a/apps/statenour/package.json b/apps/statenour/package.json",
  "--- a/apps/statenour/package.json",
  "+++ b/apps/statenour/package.json",
  '   "dependencies": {',
  '+    "zod": "^4.1.0",',
  '     "next": "16.0.0"',
  "   }",
].join("\n");

test("FIRES: a new dependency with no citation fails", () => {
  const v = assess(ADD_DEP, "Bumped a thing because it seemed newer.");
  assert.equal(v.triggered, true);
  assert.equal(v.ok, false);
  assert.match(v.changes[0].entry, /zod@\^4\.1\.0/);
});

test("PASSES: the same diff WITH a url and a date", () => {
  const v = assess(ADD_DEP, CITED_BODY);
  assert.equal(v.triggered, true);
  assert.equal(v.ok, true);
});

test("a URL alone is not a citation, and neither is a date alone", () => {
  assert.equal(assess(ADD_DEP, "see https://example.com/docs").ok, false);
  assert.equal(assess(ADD_DEP, "checked on 2026-08-28").ok, false);
});

test("catalog moves in pnpm-workspace.yaml trigger the gate", () => {
  const diff = [
    "+++ b/pnpm-workspace.yaml",
    "   catalog:",
    "+    typescript: 5.9.2",
  ].join("\n");
  assert.equal(assess(diff, "no source").triggered, true);
});

// ── Negative controls: every one of these must NOT trigger ────────────────

test("SPARES a package.json SCRIPT edit — observed on #1974", () => {
  const diff = [
    "+++ b/apps/statenour/package.json",
    '   "scripts": {',
    '+    "db:seed:sources": "tsx prisma/seeds/seed-sources-entry.ts",',
    '     "build": "next build"',
    "   }",
  ].join("\n");
  const v = assess(diff, "no citation here");
  assert.equal(v.triggered, false, "a script is not a dependency");
  assert.equal(v.ok, true);
});

test("SPARES a docs JSON that merely looks like a manifest — observed on #1972", () => {
  // A reel pack brief.json. A naive '"name": "version"' regex called this nine
  // dependency edits; that false positive is why this gate reads blocks.
  const diff = [
    "+++ b/apps/nickstire/docs/reel-packs/2026-08-28-power-mirror/brief.json",
    '+  "producedAt": "2026-08-28",',
    '+      "time": "0:00-0:04",',
    '+    "dimensions": "1080x1920",',
  ].join("\n");
  assert.equal(assess(diff, "docs only").triggered, false);
});

test("SPARES a dependency REMOVAL — dropping a package adopts nothing", () => {
  const diff = [
    "+++ b/package.json",
    '   "dependencies": {',
    '-    "left-pad": "^1.0.0",',
    "   }",
  ].join("\n");
  assert.equal(assess(diff, "removed it").triggered, false);
});

test("SPARES a lockfile-only churn diff with no manifest block", () => {
  const diff = ["+++ b/pnpm-lock.yaml", "+  /zod@4.1.0:", "+    resolution: {integrity: sha512-abc}"].join("\n");
  assert.equal(assess(diff, "").triggered, false);
});

test("SPARES a pure docs PR", () => {
  const diff = ["+++ b/docs/agent-audit/CONTROL-CANARY-COVERAGE.md", "+A new paragraph."].join("\n");
  assert.equal(assess(diff, "").triggered, false);
});

// ── The detectors themselves must be able to see (positive controls) ──────

test("POSITIVE CONTROL: dependencyChanges is not vacuously empty", () => {
  // Without this, every 'SPARES' test above would pass on a detector that
  // matched nothing at all — the blind-instrument shape, applied to this file.
  assert.ok(dependencyChanges(ADD_DEP).length > 0);
});

test("POSITIVE CONTROL: the citation matcher sees both halves", () => {
  const c = citation(CITED_BODY);
  assert.equal(c.ok, true);
  assert.match(c.url, /^https:\/\//);
  assert.equal(c.date, "2026-08-28");
  assert.equal(citation("").ok, false);
});

test("a written-out date is accepted, so the rule is not a format trap", () => {
  assert.equal(citation("https://example.com — read Aug 28, 2026").ok, true);
});
