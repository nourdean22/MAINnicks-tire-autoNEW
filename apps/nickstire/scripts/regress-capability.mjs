#!/usr/bin/env node
/**
 * Post-merge finding remediation: regress a capability's operational state
 * and record the blocker, so the ledger cannot keep claiming a maturity a
 * review finding contradicts. P0/P1 findings demote any state above
 * integration_verified back to integration_verified (the validator forbids
 * P0/P1 at deployed+); P2 findings attach without demotion. Regenerates the
 * Reality Ledger.
 *
 * Usage: node scripts/regress-capability.mjs <capabilityId> <P0|P1|P2> "<description>" "<source>"
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [id, severity, description, source] = process.argv.slice(2);
if (!id || !["P0", "P1", "P2"].includes(severity) || !description) {
  console.error('usage: regress-capability.mjs <capabilityId> <P0|P1|P2> "<description>" "<source>"');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, "..", "docs", "operations", "capability-ledger.json");
const ledger = JSON.parse(readFileSync(file, "utf8"));
const cap = ledger.capabilities.find((c) => c.capabilityId === id);
if (!cap) {
  console.error(`capability ${id} not found`);
  process.exit(2);
}
cap.blockers = [...(cap.blockers ?? []), { severity, description, source: source ?? "post-merge review" }];

const ORDER = ["unverified", "unit_verified", "integration_verified", "deployed", "live_verified", "visually_verified", "business_verified"];
const before = cap.operationalState;
if ((severity === "P0" || severity === "P1") && ORDER.indexOf(cap.operationalState) > ORDER.indexOf("integration_verified")) {
  cap.operationalState = "integration_verified";
  // demoted evidence stays on record but the state no longer claims it
}
if (severity === "P0" && ["limited_autonomy", "production"].includes(cap.exposure)) {
  cap.exposure = "operator_only";
}
writeFileSync(file, JSON.stringify(ledger, null, 2));
console.log(`✓ ${id}: blocker recorded (${severity}); operationalState ${before} -> ${cap.operationalState}; exposure ${cap.exposure}`);
execFileSync("node", [path.join(here, "render-reality-ledger.mjs")], { stdio: "inherit" });
