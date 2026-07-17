#!/usr/bin/env node
/**
 * Reality Control — deterministic contradiction detector.
 *
 * Compares what a PR SAYS against what the evidence SHOWS. No model judgment.
 * The #816 case is the template: a PR whose own body said "do not merge until
 * the release standard is met" was merged with its remaining-work list open.
 *
 * Checks:
 *  1. PR body contains a do-not-merge/remaining-before-merge clause
 *     -> requires .completion/merge-intent.json explicitly acknowledging the
 *        remaining items as deferred-not-blocking (with a reason). Absent
 *        acknowledgment = BLOCK.
 *  2. Executable claims (.completion/claims.json): every claim must name
 *     evidence refs that exist on disk. A claim without living evidence is
 *     labeled "IMPLEMENTATION CLAIM - NOT VERIFIED" and blocks.
 *  3. Ledger-vs-language: capabilities whose operationalState is below
 *     live_verified may not be described with "live verified" language in
 *     the PR body (crude but deterministic: "<name> is live" / "live
 *     verified" phrases cross-checked against the ledger).
 *
 * Usage: node scripts/detect-contradictions.mjs [--pr-body-file <path>] [--enforce]
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const enforce = args.includes("--enforce");
const bodyIdx = args.indexOf("--pr-body-file");
const bodyFile = bodyIdx >= 0 ? args[bodyIdx + 1] : null;
const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();

const problems = [];

// ── 1. Do-not-merge clause vs merge intent ─────────────────────────────────
const DO_NOT_MERGE_PATTERNS = [
  /do not merge until/i,
  /must not merge until/i,
  /remaining before merge/i,
  /will not be presented for merge until/i,
  /not ready to merge/i,
];
if (bodyFile && existsSync(bodyFile)) {
  const body = readFileSync(bodyFile, "utf8");
  const hit = DO_NOT_MERGE_PATTERNS.find((p) => p.test(body));
  if (hit) {
    const intentPath = path.join(repoRoot, ".completion", "merge-intent.json");
    if (!existsSync(intentPath)) {
      problems.push(
        `PR body contains a do-not-merge clause (${hit}) but no .completion/merge-intent.json acknowledges the remaining work as deferred-not-blocking. This is the #816 failure shape - BLOCK.`,
      );
    } else {
      const intent = JSON.parse(readFileSync(intentPath, "utf8"));
      if (!intent.acknowledgedRemaining || !intent.reason) {
        problems.push("merge-intent.json exists but lacks acknowledgedRemaining[] + reason - BLOCK.");
      }
    }
  }
}

// ── 2. Executable claims must carry living evidence ────────────────────────
const claimsPath = path.join(repoRoot, ".completion", "claims.json");
if (existsSync(claimsPath)) {
  const claims = JSON.parse(readFileSync(claimsPath, "utf8"));
  for (const claim of claims.claims ?? []) {
    const refs = claim.evidence ?? [];
    if (!refs.length) {
      problems.push(`claim "${claim.id}": IMPLEMENTATION CLAIM - NOT VERIFIED (no evidence refs)`);
      continue;
    }
    for (const ref of refs) {
      if (ref.file && !existsSync(path.join(repoRoot, ref.file))) {
        problems.push(`claim "${claim.id}": evidence file missing on disk: ${ref.file}`);
      }
    }
  }
}

// ── 3. Ledger-vs-language ──────────────────────────────────────────────────
if (bodyFile && existsSync(bodyFile)) {
  const body = readFileSync(bodyFile, "utf8").toLowerCase();
  const ledgerPath = path.join(repoRoot, "apps", "nickstire", "docs", "operations", "capability-ledger.json");
  if (existsSync(ledgerPath)) {
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    const OP_STATES = ["unverified", "unit_verified", "integration_verified", "deployed", "live_verified", "visually_verified", "business_verified"];
    for (const cap of ledger.capabilities ?? []) {
      const below = OP_STATES.indexOf(cap.operationalState) < OP_STATES.indexOf("live_verified");
      if (!below) continue;
      const name = cap.name.toLowerCase().split(" (")[0];
      if (name.length > 6 && body.includes(name) && /live[- ]verified/.test(body)) {
        const region = body.slice(Math.max(0, body.indexOf(name) - 200), body.indexOf(name) + 200);
        if (/live[- ]verified/.test(region)) {
          problems.push(`PR body describes "${cap.name}" near "live verified" language but its ledger operationalState is ${cap.operationalState}`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`✗ contradiction detector: ${problems.length} contradiction(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(enforce ? 1 : 0);
}
console.log("✓ contradiction detector: no contradictions between claims, evidence, and the ledger");
