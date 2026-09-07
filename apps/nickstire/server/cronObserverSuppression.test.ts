/**
 * Canaries for the cron observer's alert suppression.
 *
 * THE DEFECT BEING FIXED. `lastAlertAt` was an in-memory Map "cleared on
 * restart", which made ALERT_SUPPRESS_MS decorative: every deploy reset it.
 * Measured 2026-08-29 - reel-pipeline and higgsfield-session-keepalive were
 * failing continuously (295 and 296 runs in 72h) and the observer sent 2 alerts
 * on each of 25 separate runs: roughly 50 delivered Telegram messages in three
 * days against a 6h window, because that day's merges kept restarting the
 * container. That is alert fatigue manufactured by a persistence bug, not an
 * under-alerting problem.
 *
 * THE DEFECT THIS FILE EXISTS TO PREVENT NEXT. Persisting a timestamp is one
 * edit away from suppressing FOREVER - write the state once, never expire it,
 * and the channel goes quiet while the outage continues. "It never alerted
 * again" and "nothing was wrong" produce identical evidence.
 *
 * So the load-bearing test here is not "it suppresses". It is the POSITIVE
 * CONTROL: once the window genuinely elapses, an alert fires again. Every
 * suppression assertion below is paired with one, against fixture clocks this
 * file controls rather than live config.
 */
import { describe, it, expect } from "vitest";
import { shouldAlertNow } from "./cron/observer";

const HOUR = 60 * 60 * 1000;
const SUPPRESS_6H = 6 * HOUR;
const SUPPRESS_24H = 24 * HOUR;
const NOW = Date.UTC(2026, 7, 29, 12, 0, 0); // fixed clock, no Date.now()

describe("shouldAlertNow", () => {
  it("alerts when it has never alerted before", () => {
    expect(shouldAlertNow(null, NOW, SUPPRESS_6H)).toBe(true);
  });

  it("SUPPRESSES inside the window", () => {
    expect(shouldAlertNow(NOW - 1 * HOUR, NOW, SUPPRESS_6H)).toBe(false);
    expect(shouldAlertNow(NOW - 5 * HOUR, NOW, SUPPRESS_6H)).toBe(false);
    // One millisecond short of the window is still suppressed.
    expect(shouldAlertNow(NOW - SUPPRESS_6H + 1, NOW, SUPPRESS_6H)).toBe(false);
  });

  // THE POSITIVE CONTROL. Without this, an implementation that returned false
  // unconditionally - i.e. permanent silence - would pass every test above.
  it("ALERTS AGAIN once the window elapses", () => {
    expect(shouldAlertNow(NOW - SUPPRESS_6H, NOW, SUPPRESS_6H)).toBe(true);
    expect(shouldAlertNow(NOW - 7 * HOUR, NOW, SUPPRESS_6H)).toBe(true);
    expect(shouldAlertNow(NOW - 30 * 24 * HOUR, NOW, SUPPRESS_6H)).toBe(true);
  });

  it("keeps alerting on every subsequent window for a persistent failure", () => {
    // A job failing for four days must not go quiet after the first alert.
    let last: number | null = null;
    let fired = 0;
    for (let t = NOW; t < NOW + 4 * 24 * HOUR; t += 15 * 60 * 1000) {
      if (shouldAlertNow(last, t, SUPPRESS_6H)) {
        fired++;
        last = t;
      }
    }
    // Alerts land at NOW + 6h*k for k = 0..15; the loop is half-open so
    // NOW + 96h is excluded. 16 alerts over four days - roughly four a day,
    // against the ~50 in three days the unpersisted version produced.
    expect(fired).toBe(16);
  });

  it("honours a different window independently (shape alerts use 24h)", () => {
    expect(shouldAlertNow(NOW - 7 * HOUR, NOW, SUPPRESS_24H)).toBe(false);
    expect(shouldAlertNow(NOW - 25 * HOUR, NOW, SUPPRESS_24H)).toBe(true);
  });

  // FAIL OPEN. If the stored value is unreadable, alert rather than suppress:
  // a duplicate alert is recoverable, a silent outage is not.
  it("alerts when the persisted value is not a finite number", () => {
    expect(shouldAlertNow(Number.NaN, NOW, SUPPRESS_6H)).toBe(true);
    expect(shouldAlertNow(Number.POSITIVE_INFINITY, NOW, SUPPRESS_6H)).toBe(true);
  });

  // The restart case that caused the incident: an in-memory Map came back empty,
  // which reads as null - and null must NOT be treated as "alerted just now".
  it("a cleared cache (null) alerts rather than silently suppressing", () => {
    expect(shouldAlertNow(null, NOW, SUPPRESS_24H)).toBe(true);
  });
});

/* -- review findings from PR #1996, each locked ---------------------------- */

import { excludeStagedJobs } from "./cron/observer";
import { MANUAL_TRIGGER_STAGED } from "./cron/registry-tier-map";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const snap = (jobName: string) => ({
  jobName,
  consecutiveFailures: 295,
  latestError: "preflight: higgsfield session dead",
  latestFailureAt: new Date(NOW),
});

describe("staged jobs do not page (review #1996)", () => {
  // A staged job stops writing rows, so its LAST rows stay failures forever and
  // the lookback reads a frozen streak as current. Without this the staging
  // commit would have paged ~8 times a day for the whole lookback window.
  it("drops every job listed in MANUAL_TRIGGER_STAGED", () => {
    const stagedNames = MANUAL_TRIGGER_STAGED.map((j) => j.name);
    expect(stagedNames.length).toBeGreaterThan(0);
    const out = excludeStagedJobs(stagedNames.map(snap));
    expect(out).toEqual([]);
  });

  // POSITIVE CONTROL: a job that is NOT staged must still page. A filter that
  // dropped everything would pass the test above and silence the whole observer.
  it("STILL pages for a job that is not staged", () => {
    const out = excludeStagedJobs([snap("some-live-job")]);
    expect(out).toHaveLength(1);
    expect(out[0].jobName).toBe("some-live-job");
  });

  it("keeps live jobs while dropping staged ones in the same batch", () => {
    // The staged fixtures are DERIVED, not hardcoded. This test named
    // "reel-pipeline" until 2026-09-07, when that job was promoted off staging
    // (gated on HIGGSFIELD_API_KEY_ID instead) and the test failed for the
    // right reason wearing the wrong clothes — the filter was correct and the
    // example was stale. Reading the registry keeps the two in step.
    const stagedNames = MANUAL_TRIGGER_STAGED.map((j) => j.name);
    expect(stagedNames.length, "no staged jobs left — this test needs at least one").toBeGreaterThan(0);
    const mixed = [...stagedNames.map(snap), snap("some-live-job")];
    expect(excludeStagedJobs(mixed).map((f) => f.jobName)).toEqual(["some-live-job"]);
  });

  it("a PROMOTED job is no longer suppressed — silence must not outlive staging", () => {
    // The other direction, and the one that bites later: a job removed from
    // MANUAL_TRIGGER_STAGED must start paging again. Without this, promoting a
    // job while the observer still swallows its failures produces a cron that
    // runs, fails, and never tells anyone.
    expect(MANUAL_TRIGGER_STAGED.map((j) => j.name)).not.toContain("reel-pipeline");
    expect(excludeStagedJobs([snap("reel-pipeline")]).map((f) => f.jobName)).toEqual(["reel-pipeline"]);
  });
});

describe("staged adapters must not nest the cron lock (review #1996)", () => {
  // runJobByName already holds the lock; re-acquiring it returns "skipped",
  // which the adapter discarded — reporting a completion for a run that never
  // happened. Asserted on the SOURCE because the defect is which function the
  // adapter calls, and a green result is exactly what the bug produced.
  it("the staged adapters call runTierJobHandlerUnlocked, never runTierJobByName", () => {
    const src = readFileSync(resolve(process.cwd(), "server/cron/index.ts"), "utf8");
    for (const name of ["reel-pipeline", "higgsfield-session-keepalive"]) {
      const idx = src.indexOf(`registerJob("${name}"`);
      expect(idx, `${name} adapter missing`).toBeGreaterThan(-1);
      // Strip comments first: this adapter's own comment EXPLAINS why it must
      // not call runTierJobByName, and asserting on raw text made the
      // explanation trip the check. Mention is not execution - the same
      // false-positive class the guard-red-team notes warn about.
      const block = src
        .slice(idx, idx + 900)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(block, `${name} must not nest the lock`).not.toContain("runTierJobByName");
      expect(block, `${name} must use the unlocked path`).toContain("runTierJobHandlerUnlocked");
    }
  });
});
