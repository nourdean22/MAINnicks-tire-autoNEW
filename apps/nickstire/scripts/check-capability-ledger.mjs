#!/usr/bin/env node
/**
 * Reality Control — capability ledger validator (three-axis model).
 *
 * Three INDEPENDENT axes per capability:
 *   codeState        — where the code is (a merge changes ONLY this)
 *   operationalState — what evidence proves (advances only with evidence)
 *   exposure         — who can reach it (the promotion-authority decision)
 *
 * Evidence gates on operationalState (cumulative):
 *   unit_verified+         -> evidence.tests
 *   integration_verified+  -> evidence.codeCommit
 *   deployed+              -> evidence.deploymentId
 *   live_verified+         -> evidence.liveRuns OR evidence.databaseAssertions
 *   visually_verified+     -> evidence.renderedAssets OR evidence.screenshots
 *   business_verified      -> evidence.businessMetrics
 *
 * Cross-axis rules:
 *   - operationalState deployed+ cannot carry P0/P1 blockers (resolve or demote)
 *   - exposure production          requires operationalState >= live_verified
 *   - exposure limited_autonomy    requires operationalState >= live_verified
 *   - exposure operator_only       requires operationalState >= integration_verified
 *   - exposure beyond "disabled"   requires codeState merged
 *   - verificationExpiresAt in the past => REVERIFICATION REQUIRED (error)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CODE_STATES = ["not_started", "in_progress", "merged", "retired"];
const OP_STATES = [
  "unverified",
  "unit_verified",
  "integration_verified",
  "deployed",
  "live_verified",
  "visually_verified",
  "business_verified",
];
const EXPOSURES = ["disabled", "shadow", "internal", "operator_only", "limited_autonomy", "production"];
const SEVERITIES = ["P0", "P1", "P2", "P3"];

export function validateLedger(ledger, now = new Date()) {
  const errors = [];
  if (!Array.isArray(ledger.capabilities)) return ["capabilities must be an array"];
  const seen = new Set();
  for (const cap of ledger.capabilities) {
    const id = cap.capabilityId ?? "(missing id)";
    const err = (msg) => errors.push(`${id}: ${msg}`);
    if (!cap.capabilityId || typeof cap.capabilityId !== "string") err("capabilityId required");
    if (seen.has(cap.capabilityId)) err("duplicate capabilityId");
    seen.add(cap.capabilityId);
    if (!cap.name) err("name required");
    if (!cap.owner) err("owner required");
    if (!CODE_STATES.includes(cap.codeState)) { err(`invalid codeState "${cap.codeState}"`); continue; }
    if (!OP_STATES.includes(cap.operationalState)) { err(`invalid operationalState "${cap.operationalState}"`); continue; }
    if (!EXPOSURES.includes(cap.exposure)) { err(`invalid exposure "${cap.exposure}"`); continue; }

    const op = OP_STATES.indexOf(cap.operationalState);
    const ev = cap.evidence ?? {};
    const nonEmpty = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0);

    if (op >= OP_STATES.indexOf("unit_verified") && !nonEmpty(ev.tests)) err(`operationalState ${cap.operationalState} requires evidence.tests`);
    if (op >= OP_STATES.indexOf("integration_verified") && !nonEmpty(ev.codeCommit)) err(`operationalState ${cap.operationalState} requires evidence.codeCommit`);
    if (op >= OP_STATES.indexOf("deployed") && !nonEmpty(ev.deploymentId)) err(`operationalState ${cap.operationalState} requires evidence.deploymentId`);
    if (op >= OP_STATES.indexOf("live_verified") && !nonEmpty(ev.liveRuns) && !nonEmpty(ev.databaseAssertions)) {
      err(`operationalState ${cap.operationalState} requires evidence.liveRuns or evidence.databaseAssertions`);
    }
    if (op >= OP_STATES.indexOf("visually_verified") && !nonEmpty(ev.renderedAssets) && !nonEmpty(ev.screenshots)) {
      err(`operationalState ${cap.operationalState} requires evidence.renderedAssets or evidence.screenshots`);
    }
    if (op >= OP_STATES.indexOf("business_verified") && !nonEmpty(ev.businessMetrics)) {
      err(`operationalState ${cap.operationalState} requires evidence.businessMetrics`);
    }

    const blockers = Array.isArray(cap.blockers) ? cap.blockers : [];
    for (const b of blockers) {
      if (!SEVERITIES.includes(b.severity)) err(`blocker severity invalid: ${b.severity}`);
      if (!b.description) err("blocker missing description");
    }
    const hasHigh = blockers.some((b) => b.severity === "P0" || b.severity === "P1");
    if (op >= OP_STATES.indexOf("deployed") && hasHigh) {
      err(`operationalState ${cap.operationalState} cannot carry P0/P1 blockers — resolve them or demote`);
    }

    // Cross-axis promotion rules.
    const exp = EXPOSURES.indexOf(cap.exposure);
    if (exp > EXPOSURES.indexOf("disabled") && cap.codeState !== "merged") {
      err(`exposure ${cap.exposure} requires codeState merged (is ${cap.codeState})`);
    }
    if (cap.exposure === "production" && op < OP_STATES.indexOf("live_verified")) {
      err(`exposure production requires operationalState >= live_verified (is ${cap.operationalState})`);
    }
    if (cap.exposure === "limited_autonomy" && op < OP_STATES.indexOf("live_verified")) {
      err(`exposure limited_autonomy requires operationalState >= live_verified (is ${cap.operationalState})`);
    }
    if (cap.exposure === "operator_only" && op < OP_STATES.indexOf("integration_verified")) {
      err(`exposure operator_only requires operationalState >= integration_verified (is ${cap.operationalState})`);
    }

    // Evidence expiry — stale truth regresses, loudly.
    if (cap.verificationExpiresAt && new Date(cap.verificationExpiresAt).getTime() < now.getTime()) {
      err(`verification EXPIRED ${cap.verificationExpiresAt} — REVERIFICATION REQUIRED: demote operationalState or re-verify`);
    }
  }
  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "operations", "capability-ledger.json");
  const ledger = JSON.parse(readFileSync(file, "utf8"));
  const errors = validateLedger(ledger);
  if (errors.length) {
    console.error(`✗ capability ledger INVALID (${errors.length} violation${errors.length === 1 ? "" : "s"}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const counts = {};
  for (const c of ledger.capabilities) counts[c.operationalState] = (counts[c.operationalState] ?? 0) + 1;
  console.log(`✓ capability ledger valid — ${ledger.capabilities.length} capabilities; operational: ${Object.entries(counts).map(([s, n]) => `${s}=${n}`).join(", ")}`);
}
