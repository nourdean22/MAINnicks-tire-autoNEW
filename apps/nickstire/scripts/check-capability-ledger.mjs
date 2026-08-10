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
 *   - operationalState deployed+   requires verificationExpiresAt (see below)
 *
 * TWO QUESTIONS, DELIBERATELY SEPARATE (2026-08-10):
 *
 *   validateLedger()  — "did you claim something you cannot support?"
 *                       Structural and timeless. Errors block, always.
 *   assessFreshness() — "do we still KNOW this is true?"
 *                       Temporal. Stale is not failure; it is the absence
 *                       of current knowledge while behaving as if we had it.
 *
 * Why they were split: expiry used to be an error inside validateLedger, and
 * that fused a lie ("evidence I never had") with a doubt ("evidence I had a
 * month ago"). The two deserve different responses. A lie must be corrected.
 * A doubt must be RE-PROVEN or the claim LOWERED — and until the operator
 * picks one, the honest machine response is to say so out loud, not to halt
 * work that never depended on the stale claim.
 *
 * So staleness BLOCKS only where the stale claim is load-bearing — exposure
 * production or limited_autonomy, the states in which something other than
 * the operator's own hands can act on it. Everywhere else it is reported and
 * rendered, never fatal. A gate that fails on all 48 gets muted; a gate that
 * fails on none is decoration. This one fails where guessing escapes.
 *
 * verificationExpiresAt is REQUIRED at deployed+ because those claims rest on
 * evidence that can rot with no commit at all: a credential dying, a session
 * expiring, prod data drifting, a provider revoking quota. Below deployed, the
 * claim rests on tests that re-run in every CI pass — close to self-renewing,
 * so the field stays optional there. Requiring it is what stops capability #49
 * from silently inheriting the old bug: for 48 capabilities this field existed,
 * was tested, and was set by NONE of them.
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

/** At and above this operationalState, a claim rests on evidence that can rot
 *  without any commit — so it must carry an explicit expiry. */
export const FRESHNESS_REQUIRED_FROM = "deployed";

/** Exposures where a stale claim can be acted on by something other than the
 *  operator's own hands. Staleness is fatal only here. */
export const BLOCKING_EXPOSURES = new Set(["production", "limited_autonomy"]);

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

    // Not "is it stale?" — that is assessFreshness's question. This is the
    // structural one: at deployed+ you must have DECIDED how long this claim
    // survives without re-proof. Silence is the failure mode being closed.
    if (op >= OP_STATES.indexOf(FRESHNESS_REQUIRED_FROM)) {
      if (!cap.verificationExpiresAt) {
        err(`operationalState ${cap.operationalState} requires verificationExpiresAt — decide how long this claim survives without re-proof`);
      } else if (Number.isNaN(new Date(cap.verificationExpiresAt).getTime())) {
        err(`verificationExpiresAt is not a parseable date: "${cap.verificationExpiresAt}"`);
      }
    }
  }
  return errors;
}

/**
 * The mirror. Reports which claims we can no longer say we KNOW, and which of
 * those are load-bearing enough that continuing to claim them is not allowed.
 *
 * Returns findings, never throws, never mutates. `blocking` is the only thing
 * that should ever fail a build — everything else is the system telling the
 * truth about its own uncertainty.
 */
export function assessFreshness(ledger, now = new Date()) {
  const findings = [];
  for (const cap of ledger.capabilities ?? []) {
    if (!cap.verificationExpiresAt) continue;
    const expires = new Date(cap.verificationExpiresAt).getTime();
    if (Number.isNaN(expires) || expires >= now.getTime()) continue;
    findings.push({
      capabilityId: cap.capabilityId,
      name: cap.name,
      expiresAt: cap.verificationExpiresAt,
      exposure: cap.exposure,
      operationalState: cap.operationalState,
      daysOverdue: Math.floor((now.getTime() - expires) / 86_400_000),
      blocking: BLOCKING_EXPOSURES.has(cap.exposure),
    });
  }
  return findings;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "operations", "capability-ledger.json");
  const ledger = JSON.parse(readFileSync(file, "utf8"));
  const errors = validateLedger(ledger);
  const stale = assessFreshness(ledger);

  // Print BOTH before deciding the exit code. A mirror that stops at the first
  // crack shows you less than one that shows the whole face.
  if (errors.length) {
    console.error(`✗ capability ledger INVALID (${errors.length} violation${errors.length === 1 ? "" : "s"}):`);
    for (const e of errors) console.error(`  - ${e}`);
  }
  if (stale.length) {
    const blocking = stale.filter((s) => s.blocking);
    console.error(
      `\n⧗ ${stale.length} capabilit${stale.length === 1 ? "y is" : "ies are"} past re-verification — we are behaving as if we still know:`,
    );
    for (const s of stale) {
      console.error(
        `  ${s.blocking ? "✗" : "·"} ${s.capabilityId} — expired ${s.expiresAt} (${s.daysOverdue}d), ${s.operationalState} @ ${s.exposure}` +
          (s.blocking ? "  ← LOAD-BEARING: re-prove it or lower the claim" : ""),
      );
    }
    console.error(
      blocking.length
        ? `\n  ${blocking.length} of these can be acted on outside the operator's hands. Re-verify (reset verificationExpiresAt) or demote (scripts/regress-capability.mjs).`
        : `\n  None are load-bearing — reported, not fatal. Re-prove or demote when you next touch them.`,
    );
  }

  if (errors.length || stale.some((s) => s.blocking)) process.exit(1);

  const counts = {};
  for (const c of ledger.capabilities) counts[c.operationalState] = (counts[c.operationalState] ?? 0) + 1;
  console.log(
    `✓ capability ledger valid — ${ledger.capabilities.length} capabilities; operational: ${Object.entries(counts).map(([s, n]) => `${s}=${n}`).join(", ")}` +
      (stale.length ? `; ${stale.length} stale (none load-bearing)` : ""),
  );
}
