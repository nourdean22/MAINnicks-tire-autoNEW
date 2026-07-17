#!/usr/bin/env node
/**
 * Completion Authority — Definition-of-Done COMPILER.
 *
 * A checklist is too weak: requirements must be DERIVED from what actually
 * changed. This reads the diff against a base ref, maps touched paths to
 * mandatory completion requirements, and checks the branch's evidence
 * manifest (.completion/evidence.json) for each. With --enforce, missing
 * required evidence exits 1 — wired into CI so a PR cannot quietly claim
 * completion its diff does not support.
 *
 * Usage: node scripts/dod-compiler.mjs [--base origin/main] [--enforce]
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  {
    id: "migration-evidence",
    match: /apps\/nickstire\/drizzle\/\d{4}_.*\.sql$|apps\/nickstire\/scripts\/apply-\d{4}.*\.mts$/,
    description: "Schema change: migration must have an idempotent apply script AND application evidence (or an explicit operator-pending note).",
  },
  {
    id: "publish-boundary-test",
    match: /apps\/nickstire\/server\/services\/socialPublish\.ts$|apps\/nickstire\/server\/services\/metaSocial\.ts$/,
    description: "Publish path touched: publish-boundary behavior (kill switches / cadence / claim gates) needs test evidence.",
  },
  {
    id: "render-spend-trajectory",
    match: /apps\/nickstire\/server\/services\/reelPipeline\.ts$|apps\/nickstire\/server\/services\/higgsfieldStudio\.ts$/,
    description: "Provider-spend path touched: trajectory test through the service boundary (policy + persistence) required.",
  },
  {
    id: "visual-world-trajectory",
    match: /visualWorld|facelessReelStudio\.ts$/,
    description: "Visual World touched: persisted-prompt trajectory evidence required (locked invariants reach the final payload).",
  },
  {
    id: "policy-matrix",
    match: /autonomyPolicy\.ts$|autonomyControl\.ts$/,
    description: "Policy engine touched: kill-switch/actor matrix tests required across caller paths.",
  },
  {
    id: "cron-fail-closed",
    match: /apps\/nickstire\/server\/cron\//,
    description: "Cron touched: non-operator fail-closed behavior needs test evidence.",
  },
  {
    id: "operator-walkthrough",
    match: /apps\/nickstire\/client\/src\/(pages|components)\/admin\//,
    description: "Operator UI touched: a walkthrough note (live or explicitly deferred with reason) is required.",
  },
  {
    id: "capability-ledger-updated",
    match: /apps\/nickstire\/(server\/services|client\/src\/lib)\//,
    description: "Capability code touched: docs/operations/capability-ledger.json must be part of the diff (states/evidence updated).",
    satisfiedByDiff: /apps\/nickstire\/docs\/operations\/capability-ledger\.json$/,
  },
];

const args = process.argv.slice(2);
const enforce = args.includes("--enforce");
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 ? args[baseIdx + 1] : "origin/main";

const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
let files = [];
try {
  files = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8", cwd: repoRoot })
    .split(/\r?\n/)
    .filter(Boolean);
} catch {
  console.error(`could not diff against ${base}`);
  process.exit(enforce ? 1 : 0);
}

const manifestPath = path.join(repoRoot, ".completion", "evidence.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { evidence: {} };

const requirements = [];
for (const rule of RULES) {
  const touched = files.filter((f) => rule.match.test(f));
  if (!touched.length) continue;
  const fromDiff = rule.satisfiedByDiff ? files.some((f) => rule.satisfiedByDiff.test(f)) : false;
  const ev = manifest.evidence?.[rule.id];
  const status = fromDiff || (ev && (ev.ref || ev.deferred)) ? (ev?.deferred ? "deferred" : "passed") : "missing";
  requirements.push({ id: rule.id, description: rule.description, touched: touched.length, status, evidence: ev?.ref ?? (fromDiff ? "(satisfied by diff)" : ev?.deferred ? `DEFERRED: ${ev.deferred}` : null) });
}

if (!requirements.length) {
  console.log(`✓ DoD compiler: no completion requirements derived from ${files.length} changed files`);
  process.exit(0);
}

console.log(`DoD compiler — ${files.length} changed files vs ${base} → ${requirements.length} derived requirement(s):`);
let missing = 0;
for (const r of requirements) {
  const mark = r.status === "passed" ? "✓" : r.status === "deferred" ? "◐" : "✗";
  if (r.status === "missing") missing++;
  console.log(`  ${mark} [${r.id}] (${r.touched} file${r.touched === 1 ? "" : "s"}) ${r.status.toUpperCase()}${r.evidence ? ` — ${r.evidence}` : ""}`);
  if (r.status === "missing") console.log(`      ${r.description}`);
}
if (missing && enforce) {
  console.error(`\n✗ ${missing} required completion evidence item(s) missing. Add them to .completion/evidence.json (with a ref, or an explicit deferred reason).`);
  process.exit(1);
}
console.log(missing ? `\n◐ ${missing} missing (advisory mode — pass --enforce to gate)` : "\n✓ all derived requirements have evidence or explicit deferral");
