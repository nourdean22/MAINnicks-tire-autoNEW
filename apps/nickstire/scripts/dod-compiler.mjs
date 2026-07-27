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

/**
 * EVIDENCE MUST BE FRESH, NOT MERELY PRESENT.
 *
 * Requirements are derived per-diff but the manifest lives on main, so an entry
 * written for an unrelated change months ago silently satisfied a NEW one.
 * Observed 2026-07-27: a PR touching server/services/ passed
 * `capability-ledger-updated` on a ref describing media-asset-registry and
 * drive-creative-vault — work with no relation to that diff. The gate reported
 * completion evidence that had never been produced for the thing it was
 * gating, which is the exact failure mode it exists to prevent, applied to
 * itself.
 *
 * An entry now counts only if THIS branch wrote or changed it. Reading the base
 * revision of the manifest is the whole check; a missing file at base means
 * every entry is new.
 */
let baseEvidence = {};
try {
  const raw = execSync(`git show ${base}:.completion/evidence.json`, {
    encoding: "utf8", cwd: repoRoot, stdio: ["pipe", "pipe", "ignore"],
  });
  baseEvidence = JSON.parse(raw).evidence ?? {};
} catch {
  // No manifest at base — nothing can be stale.
}
const isFresh = (id) => JSON.stringify(manifest.evidence?.[id]) !== JSON.stringify(baseEvidence[id]);

const requirements = [];
for (const rule of RULES) {
  const touched = files.filter((f) => rule.match.test(f));
  if (!touched.length) continue;
  const fromDiff = rule.satisfiedByDiff ? files.some((f) => rule.satisfiedByDiff.test(f)) : false;
  const ev = manifest.evidence?.[rule.id];
  const hasEntry = Boolean(ev && (ev.ref || ev.deferred));
  const fresh = hasEntry && isFresh(rule.id);
  const status = fromDiff
    ? "passed"
    : fresh
      ? (ev.deferred ? "deferred" : "passed")
      : hasEntry
        ? "stale"
        : "missing";
  requirements.push({
    id: rule.id,
    description: rule.description,
    touched: touched.length,
    status,
    evidence: status === "stale"
      ? `written for an EARLIER change, not this diff — ${String(ev.ref ?? ev.deferred).slice(0, 90)}`
      : ev?.ref ?? (fromDiff ? "(satisfied by diff)" : ev?.deferred ? `DEFERRED: ${ev.deferred}` : null),
  });
}

if (!requirements.length) {
  console.log(`✓ DoD compiler: no completion requirements derived from ${files.length} changed files`);
  process.exit(0);
}

console.log(`DoD compiler — ${files.length} changed files vs ${base} → ${requirements.length} derived requirement(s):`);
let missing = 0;
for (const r of requirements) {
  const mark = r.status === "passed" ? "✓" : r.status === "deferred" ? "◐" : "✗";
  // STALE counts as missing: an entry written for an earlier change is not
  // evidence for this one, and treating it as such is what let this gate pass
  // itself on unrelated work.
  if (r.status === "missing" || r.status === "stale") missing++;
  console.log(`  ${mark} [${r.id}] (${r.touched} file${r.touched === 1 ? "" : "s"}) ${r.status.toUpperCase()}${r.evidence ? ` — ${r.evidence}` : ""}`);
  if (r.status === "missing" || r.status === "stale") console.log(`      ${r.description}`);
}
if (missing && enforce) {
  console.error(
    `\n✗ ${missing} required completion evidence item(s) missing or STALE.\n` +
    `  Add or UPDATE them in .completion/evidence.json (a ref, or an explicit deferred reason).\n` +
    `  STALE means the entry EXISTS but was written for an earlier change. The manifest lives\n` +
    `  on main while requirements are derived per-diff, so an untouched entry is not evidence\n` +
    `  for YOUR diff — rewrite it to describe what THIS change proves.`,
  );
  process.exit(1);
}
console.log(missing ? `\n◐ ${missing} missing (advisory mode — pass --enforce to gate)` : "\n✓ all derived requirements have evidence or explicit deferral");
