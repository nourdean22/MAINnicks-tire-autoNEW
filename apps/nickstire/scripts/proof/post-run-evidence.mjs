#!/usr/bin/env node
/**
 * Post a proof run to the evidence ledger (statenour /api/sync/evidence).
 *
 * Reads apps/nickstire/test-results/results.json (Playwright json reporter)
 * and any test-results/episodes/*.failure.json, and writes:
 *   · one RealityEvent per run  (proof.run · outcome + counts + run url)
 *   · one RealityEvent per failed episode (proof.episode_failed)
 *   · one EvidenceClaim at H2 per failed episode — synthetic evidence that a
 *     real-customer path is broken, which is exactly what the Night Shift
 *     prompt reads first.
 *
 * Exits 1 when the ledger refuses the post (non-2xx, unreachable, or any
 * rejected row): 2026-09-29..10-02 every post 500'd while every run stayed
 * green. The workflow runs this step with always(), so the suite's own
 * verdict is still recorded either way; a missing key still exits 0. Needs STATENOUR_SYNC_URL + a ledger key — EVIDENCE_LEDGER_KEY
 * (scoped to /api/sync/evidence; what CI should hold) or, as a fallback,
 * STATENOUR_SYNC_KEY (the whole bridge). RUN_URL and OUTCOME come from the
 * workflow.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { holdoutEvent, summarizeHoldout } from "./holdout-summary.mjs";
import { ledgerFailure } from "./ledger-response.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESULTS = join(APP, "test-results");
const base = process.env.STATENOUR_SYNC_URL?.replace(/\/+$/, "");
const key = process.env.EVIDENCE_LEDGER_KEY || process.env.STATENOUR_SYNC_KEY;
if (!base || !key) {
  console.log("evidence: STATENOUR_SYNC_URL / EVIDENCE_LEDGER_KEY not set — skipped");
  process.exit(0);
}

const summary = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
/** Episode ids whose FINAL outcome in the Playwright report is a failure. */
const finallyFailed = new Set();
let reportReadable = false;
const resultsFile = join(RESULTS, "results.json");
if (existsSync(resultsFile)) {
  try {
    const r = JSON.parse(readFileSync(resultsFile, "utf8"));
    Object.assign(summary, r.stats ?? {});
    reportReadable = true;
    const walk = (suite) => {
      for (const s of suite.suites ?? []) walk(s);
      for (const spec of suite.specs ?? []) {
        const id = /^(EP-\d+)\b/.exec(spec.title ?? "")?.[1];
        if (!id) continue;
        // "unexpected" = failed after every retry. "flaky" = failed then passed — NOT a failure.
        if ((spec.tests ?? []).some((t) => t.status === "unexpected")) finallyFailed.add(id);
      }
    };
    walk(r);
  } catch {
    /* unreadable report — fall back to the per-attempt files below */
  }
}

// Per-attempt failure records are written by the runner and cleared on the
// next attempt, but the FINAL report is the authority: a record whose episode
// ended up passing on retry is a flake, not evidence.
const failures = [];
const epDir = join(RESULTS, "episodes");
if (existsSync(epDir)) {
  for (const f of readdirSync(epDir).filter((f) => f.endsWith(".failure.json"))) {
    try {
      const rec = JSON.parse(readFileSync(join(epDir, f), "utf8"));
      if (!reportReadable || finallyFailed.has(rec.id)) failures.push(rec);
    } catch {
      /* skip */
    }
  }
}

const now = new Date().toISOString();
const runUrl = process.env.RUN_URL ?? null;
// What was actually judged. A push-triggered run can measure the PREVIOUS deploy
// when Railway is still building (the workflow waits, bounded, then records what
// is live); a statenour-only push never redeploys nickstire at all. Both shas
// travel with the event so a reader never attributes a result to the wrong build.
const liveCommit = process.env.LIVE_COMMIT || null;
const wantCommit = process.env.WANT_COMMIT || null;
const commitObjects = liveCommit ? [{ type: "commit", id: liveCommit, role: "judged" }] : [];
const events = [
  {
    eventType: "proof.run",
    observedAt: now,
    objects: [{ type: "site", id: "nickstire.org" }, ...commitObjects],
    source: { system: "github-actions", uri: runUrl ?? undefined },
    quality: "observed",
    privacy: "internal",
    payload: {
      outcome: process.env.OUTCOME ?? "unknown",
      ...summary,
      episodeFailures: failures.map((f) => f.id),
      liveCommit,
      wantCommit,
      judgedRequestedCommit: liveCommit && wantCommit ? liveCommit === wantCommit : null,
    },
  },
  ...failures.map((f) => ({
    eventType: "proof.episode_failed",
    observedAt: f.startedAt ?? now,
    objects: [{ type: "episode", id: f.id }, { type: "route", id: safePath(f.finalUrl) }, ...commitObjects],
    source: { system: "github-actions", uri: runUrl ?? undefined },
    quality: "observed",
    privacy: "internal",
    payload: { version: f.version, error: String(f.error ?? "").slice(0, 500), elapsedMs: f.elapsedMs },
  })),
];
// Hidden holdout (2026-09-15): the second, secret episode set. Its report stays
// on the runner; only ids + counts travel. Posted EVERY run — "unmeasured" when
// the secret is absent or the unpack produced nothing — so a missing holdout
// can never be read as a passing one. Appended AFTER the failure events so the
// claim indexes below stay events[i + 1].
let holdoutSummary = null;
let holdoutReason = "no holdout secret";
const holdoutResults = process.env.HOLDOUT_RESULTS;
if (holdoutResults && existsSync(holdoutResults)) {
  try {
    holdoutSummary = summarizeHoldout(JSON.parse(readFileSync(holdoutResults, "utf8")));
  } catch {
    holdoutReason = "holdout report unreadable";
  }
} else if (process.env.HOLDOUT_UNPACKED && process.env.HOLDOUT_UNPACKED !== "0") {
  holdoutReason = "holdout unpacked but no report written";
}
const holdout = holdoutEvent({
  summary: holdoutSummary,
  outcome: process.env.HOLDOUT_OUTCOME || "unknown",
  reason: holdoutReason,
  liveCommit,
  wantCommit,
  runUrl,
  now,
});

// Each failure claim rests on its own proof.episode_failed event: events[0] is
// the run summary, events[i + 1] is failure i. The ledger resolves the index to
// the event id it created (structural lineage; the grade is capped by the door
// this key opens, H2 for the proof lane).
const claims = failures.map((f, i) => ({
  claimText: `Episode ${f.id} (v${f.version}) fails on the live site: ${String(f.error ?? "").slice(0, 200)}`,
  grade: "H2",
  hypothesisId: f.id,
  disposition: "supported",
  sourceEventIndexes: [i + 1],
}));

function safePath(u) {
  try {
    return new URL(u).pathname;
  } catch {
    return "/";
  }
}

events.push(holdout);

let failed = null;
try {
  const res = await fetch(`${base}/api/sync/evidence`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-key": key },
    body: JSON.stringify({ events, claims, sentAt: now, sender: "nickstire-proof" }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`evidence: ${res.status} — ${events.length} event(s), ${claims.length} claim(s), holdout ${holdout.payload.outcome}`);
  failed = ledgerFailure(res.status, json);
} catch (err) {
  failed = `unreachable (${err.message})`;
}
if (failed) {
  console.log(`::error title=evidence ledger::${failed}`);
  process.exit(1);
}
