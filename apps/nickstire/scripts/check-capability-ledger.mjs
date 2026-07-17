#!/usr/bin/env node
/**
 * Completion Authority — capability ledger validator.
 *
 * Makes it impossible to CALL incomplete work complete: a capability's state
 * only stands when the evidence its state requires is present, and elevated
 * states cannot carry P0/P1 blockers. Runs in CI and in verify gates.
 *
 * Evidence gates (cumulative by state):
 *   unit_verified+      -> evidence.tests (non-empty)
 *   integrated+         -> evidence.codeCommit
 *   deployed+           -> evidence.deploymentId
 *   live_verified+      -> evidence.liveRuns OR evidence.databaseAssertions
 *   visually_verified+  -> evidence.renderedAssets OR evidence.screenshots
 *   business_verified+  -> evidence.businessMetrics
 *   production_ready    -> evidence.operatorApprovalId AND zero P0/P1/P2 blockers
 * Additionally: states deployed+ cannot carry P0/P1 blockers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const VALID_STATES = [
  "proposed",
  "implemented",
  "unit_verified",
  "integrated",
  "deployed",
  "live_verified",
  "visually_verified",
  "business_verified",
  "production_ready",
];
const SEVERITIES = ["P0", "P1", "P2", "P3"];

export function validateLedger(ledger) {
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
    if (!VALID_STATES.includes(cap.state)) {
      err(`invalid state "${cap.state}"`);
      continue;
    }
    const rank = VALID_STATES.indexOf(cap.state);
    const ev = cap.evidence ?? {};
    const nonEmpty = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0);

    if (rank >= VALID_STATES.indexOf("unit_verified") && !nonEmpty(ev.tests)) {
      err(`state ${cap.state} requires evidence.tests`);
    }
    if (rank >= VALID_STATES.indexOf("integrated") && !nonEmpty(ev.codeCommit)) {
      err(`state ${cap.state} requires evidence.codeCommit`);
    }
    if (rank >= VALID_STATES.indexOf("deployed") && !nonEmpty(ev.deploymentId)) {
      err(`state ${cap.state} requires evidence.deploymentId`);
    }
    if (rank >= VALID_STATES.indexOf("live_verified") && !nonEmpty(ev.liveRuns) && !nonEmpty(ev.databaseAssertions)) {
      err(`state ${cap.state} requires evidence.liveRuns or evidence.databaseAssertions`);
    }
    if (rank >= VALID_STATES.indexOf("visually_verified") && !nonEmpty(ev.renderedAssets) && !nonEmpty(ev.screenshots)) {
      err(`state ${cap.state} requires evidence.renderedAssets or evidence.screenshots`);
    }
    if (rank >= VALID_STATES.indexOf("business_verified") && !nonEmpty(ev.businessMetrics)) {
      err(`state ${cap.state} requires evidence.businessMetrics`);
    }
    const blockers = Array.isArray(cap.blockers) ? cap.blockers : [];
    for (const b of blockers) {
      if (!SEVERITIES.includes(b.severity)) err(`blocker severity invalid: ${b.severity}`);
      if (!b.description) err("blocker missing description");
    }
    const hasHigh = blockers.some((b) => b.severity === "P0" || b.severity === "P1");
    if (rank >= VALID_STATES.indexOf("deployed") && hasHigh) {
      err(`state ${cap.state} cannot carry P0/P1 blockers — resolve them or demote the state`);
    }
    if (cap.state === "production_ready") {
      if (!nonEmpty(ev.operatorApprovalId)) err("production_ready requires evidence.operatorApprovalId");
      if (blockers.some((b) => b.severity !== "P3")) err("production_ready cannot carry P0/P1/P2 blockers");
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
  for (const c of ledger.capabilities) counts[c.state] = (counts[c.state] ?? 0) + 1;
  console.log(`✓ capability ledger valid — ${ledger.capabilities.length} capabilities: ${Object.entries(counts).map(([s, n]) => `${s}=${n}`).join(", ")}`);
}
