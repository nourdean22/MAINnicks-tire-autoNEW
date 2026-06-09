/**
 * CLI · Agent-runbook verifier.
 *
 * Asserts the runbook catalog (lib/runbooks/catalog.ts) is sound:
 *   1. unique ids.
 *   2. active runbooks have all required fields + a valid lastVerified date.
 *   3. each docPath markdown exists.
 *   4. relatedFiles exist on disk (unless prefixed external:/manual:).
 *   5. active runbooks carry NO critical stale-deploy terms (reuses the
 *      stale-doc guard's scanner).
 *
 * Run:  pnpm check:runbooks
 */

import fs from "node:fs";
import path from "node:path";
import { RUNBOOKS } from "../lib/runbooks/catalog";
import type { Runbook } from "../lib/runbooks/types";
import { scanContent } from "./check-stale-docs";

const cwd = process.cwd();
let errors = 0;
let warnings = 0;
const fail = (msg: string) => { errors++; console.error(`  ❌ ${msg}`); };
const warn = (msg: string) => { warnings++; console.warn(`  ⚠️  ${msg}`); };
const ok = (msg: string) => console.log(`  ✅ ${msg}`);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requiredFieldsOk(rb: Runbook): string[] {
  const missing: string[] = [];
  if (!rb.title?.trim()) missing.push("title");
  if (!rb.whenToUse?.trim()) missing.push("whenToUse");
  if (!rb.sourceOfTruth?.length) missing.push("sourceOfTruth");
  if (!rb.rules?.length) missing.push("rules");
  if (!rb.verification?.length) missing.push("verification");
  if (!rb.rollback?.trim()) missing.push("rollback");
  if (!rb.owner?.trim()) missing.push("owner");
  if (!rb.riskLevel) missing.push("riskLevel");
  if (!rb.docPath?.trim()) missing.push("docPath");
  return missing;
}

console.log("");
console.log("agent runbooks · verifying");
console.log("");

// ── 1 · unique ids ───────────────────────────────────────────────────
console.log("[1/5]  unique ids");
const seen = new Set<string>();
for (const rb of RUNBOOKS) {
  if (seen.has(rb.id)) fail(`duplicate runbook id: ${rb.id}`);
  seen.add(rb.id);
}
if (errors === 0) ok(`${RUNBOOKS.length} runbook ids unique`);

// ── 2 · active runbooks have required fields + valid lastVerified ─────
console.log("");
console.log("[2/5]  required fields (active)");
for (const rb of RUNBOOKS.filter((r) => r.status === "active")) {
  const missing = requiredFieldsOk(rb);
  if (missing.length) fail(`${rb.id} missing field(s): ${missing.join(", ")}`);
  if (!DATE_RE.test(rb.lastVerified || "")) fail(`${rb.id} lastVerified not YYYY-MM-DD: "${rb.lastVerified}"`);
}
if (errors === 0) ok("all active runbooks have required fields + lastVerified");

// ── 3 · docPath markdown exists ──────────────────────────────────────
console.log("");
console.log("[3/5]  docPath markdown exists");
for (const rb of RUNBOOKS) {
  const p = path.join(cwd, rb.docPath);
  if (!fs.existsSync(p)) fail(`${rb.id}: docPath missing on disk (${rb.docPath})`);
}
if (errors === 0) ok("every runbook has its markdown");

// ── 4 · relatedFiles exist (unless external:/manual:) ─────────────────
console.log("");
console.log("[4/5]  relatedFiles exist");
let missingRelated = 0;
for (const rb of RUNBOOKS) {
  for (const f of rb.relatedFiles) {
    if (f.startsWith("external:") || f.startsWith("manual:")) continue;
    if (!fs.existsSync(path.join(cwd, f))) {
      fail(`${rb.id}: relatedFile not found (${f}) — fix the path or prefix external:/manual:`);
      missingRelated++;
    }
  }
}
if (missingRelated === 0 && errors === 0) ok("all relatedFiles resolve on disk");

// ── 5 · active runbooks carry no critical stale-deploy terms ──────────
console.log("");
console.log("[5/5]  no critical stale-deploy terms in active runbook docs");
let staleHits = 0;
for (const rb of RUNBOOKS.filter((r) => r.status === "active")) {
  const p = path.join(cwd, rb.docPath);
  if (!fs.existsSync(p)) continue; // already failed in [3]
  const findings = scanContent(rb.docPath, fs.readFileSync(p, "utf8")).filter(
    (f) => f.severity === "critical",
  );
  for (const f of findings) {
    fail(`${rb.id} (${rb.docPath}:${f.line}) states a retired fact as current: "${f.term}"`);
    staleHits++;
  }
}
if (staleHits === 0 && errors === 0) ok("active runbooks contain no critical stale-deploy instructions");

console.log("");
if (errors > 0) {
  console.error(`✖ ${errors} error(s)${warnings ? `, ${warnings} warning(s)` : ""}`);
  process.exit(1);
}
console.log(`✓ runbooks clean (${RUNBOOKS.length} runbooks${warnings ? `, ${warnings} warnings` : ""})`);
