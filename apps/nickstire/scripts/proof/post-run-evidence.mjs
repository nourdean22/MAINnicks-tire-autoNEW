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
 * Best-effort: exits 0 on any ledger error so it never masks the suite's
 * own verdict. Needs STATENOUR_SYNC_URL + STATENOUR_SYNC_KEY; RUN_URL and
 * OUTCOME come from the workflow.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESULTS = join(APP, "test-results");
const base = process.env.STATENOUR_SYNC_URL?.replace(/\/+$/, "");
const key = process.env.STATENOUR_SYNC_KEY;
if (!base || !key) {
  console.log("evidence: STATENOUR_SYNC_URL / STATENOUR_SYNC_KEY not set — skipped");
  process.exit(0);
}

const summary = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
const resultsFile = join(RESULTS, "results.json");
if (existsSync(resultsFile)) {
  try {
    const r = JSON.parse(readFileSync(resultsFile, "utf8"));
    Object.assign(summary, r.stats ?? {});
  } catch {
    /* unreadable report — the run event still says so via OUTCOME */
  }
}

const failures = [];
const epDir = join(RESULTS, "episodes");
if (existsSync(epDir)) {
  for (const f of readdirSync(epDir).filter((f) => f.endsWith(".failure.json"))) {
    try {
      failures.push(JSON.parse(readFileSync(join(epDir, f), "utf8")));
    } catch {
      /* skip */
    }
  }
}

const now = new Date().toISOString();
const runUrl = process.env.RUN_URL ?? null;
const events = [
  {
    eventType: "proof.run",
    observedAt: now,
    objects: [{ type: "site", id: "nickstire.org" }],
    source: { system: "github-actions", uri: runUrl ?? undefined },
    quality: "observed",
    privacy: "internal",
    payload: { outcome: process.env.OUTCOME ?? "unknown", ...summary, episodeFailures: failures.map((f) => f.id) },
  },
  ...failures.map((f) => ({
    eventType: "proof.episode_failed",
    observedAt: f.startedAt ?? now,
    objects: [{ type: "episode", id: f.id }, { type: "route", id: safePath(f.finalUrl) }],
    source: { system: "github-actions", uri: runUrl ?? undefined },
    quality: "observed",
    privacy: "internal",
    payload: { version: f.version, error: String(f.error ?? "").slice(0, 500), elapsedMs: f.elapsedMs },
  })),
];
const claims = failures.map((f) => ({
  claimText: `Episode ${f.id} (v${f.version}) fails on the live site: ${String(f.error ?? "").slice(0, 200)}`,
  grade: "H2",
  hypothesisId: f.id,
  disposition: "supported",
  createdBy: "cron",
}));

function safePath(u) {
  try {
    return new URL(u).pathname;
  } catch {
    return "/";
  }
}

try {
  const res = await fetch(`${base}/api/sync/evidence`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-key": key },
    body: JSON.stringify({ events, claims, sentAt: now, sender: "nickstire-proof" }),
    signal: AbortSignal.timeout(10_000),
  });
  console.log(`evidence: ${res.status} — ${events.length} event(s), ${claims.length} claim(s)`);
} catch (err) {
  console.log(`evidence: unreachable (${err.message}) — skipped`);
}
