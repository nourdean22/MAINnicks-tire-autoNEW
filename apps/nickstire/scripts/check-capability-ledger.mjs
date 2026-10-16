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
 * LEAD TIME (2026-10-15). The first load-bearing expiry (shopstate-lot-band,
 * 01:07Z) turned every open PR red at once, with no sign before it. So the same
 * load-bearing set is also forecast: assessExpiringSoon() lists the entries
 * within EXPIRY_WARNING_DAYS of their date and the CLI prints one line each.
 * It is lead time, not a verdict: nothing in it can change an exit code, and it
 * shares assessFreshness's predicate, so it never forecasts a failure that the
 * expiry would not produce.
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

/** How far ahead a load-bearing expiry is announced. */
const EXPIRY_WARNING_DAYS = 14;

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
    // "NONE. No production call has…" is a HONEST statement that the evidence
    // does not exist — 11 entries write liveRuns that way at unit_verified,
    // which is right. It must never SATISFY a gate: before 2026-09-23 a
    // non-empty "NONE…" string passed `live_verified requires liveRuns`.
    const said = (v) => (Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : "");
    const ABSENT = /^\s*(?:none|n\/a|tbd|pending|not yet)\b/i;
    const nonEmpty = (v) =>
      (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim().length > 0) && !ABSENT.test(said(v));

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

/**
 * The lead time. assessFreshness reports claims already past their date; this
 * forecasts the load-bearing ones that will be, so the first sign is a line in
 * the log and not every PR going red at once. It covers exactly the dates that
 * function does not (expiring from now to EXPIRY_WARNING_DAYS out), so an entry
 * is never in both lists and no day leaves it in neither. Pure: returns
 * findings, mutates nothing, and is never a reason to fail.
 */
export function assessExpiringSoon(ledger, now = new Date()) {
  const findings = [];
  for (const cap of ledger.capabilities ?? []) {
    if (!cap.verificationExpiresAt || !BLOCKING_EXPOSURES.has(cap.exposure)) continue;
    const msLeft = new Date(cap.verificationExpiresAt).getTime() - now.getTime();
    if (Number.isNaN(msLeft) || msLeft < 0 || msLeft > EXPIRY_WARNING_DAYS * 86_400_000) continue;
    findings.push({
      capabilityId: cap.capabilityId,
      expiresAt: cap.verificationExpiresAt,
      exposure: cap.exposure,
      operationalState: cap.operationalState,
      daysLeft: Math.floor(msLeft / 86_400_000),
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
  const expiring = assessExpiringSoon(ledger);

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

  // Lead time, not a verdict: nothing here changes the exit code. It prints before the exit
  // decision so a run that fails for another reason still shows what expires next. "note:" is
  // the prefix preflight.sh surfaces from a passing step; under Actions the same text is an
  // annotation, which the run's summary page shows without opening the log.
  // Escaped per the workflow-command rules: a bare % or line break could end the annotation and start another command.
  const escapeData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (const e of expiring) {
    const text =
      `ledger entry ${e.capabilityId} expires ${e.expiresAt} (${e.daysLeft}d left, ${e.operationalState} @ ${e.exposure}). ` +
      `Re-prove it with a live receipt and reset verificationExpiresAt, or lower the claim (scripts/regress-capability.mjs), ` +
      `before then; after that every PR fails the completion-authority steps of the agent-policy job.`;
    console.log(
      process.env.GITHUB_ACTIONS === "true"
        ? `::warning title=Load-bearing ledger claim expiring soon::${escapeData(text)}`
        : `note: ${text}`,
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
