/**
 * A cron failure must be FAST, VISIBLE, and CARRY ITS REASON.
 *
 * Production state on 2026-07-20 violated all three:
 *   · gsc-pipeline failed 6/6 and pipelines-auto-run 7/8, every row
 *     details="timeout", duration_ms 240133-240172 — the scheduler's hard
 *     4-minute cap, hit to the millisecond. The jobs HUNG rather than erroring.
 *   · error_message was NULL on every single row, so the failure observer's
 *     alerts would have read "no error message logged".
 *   · The handlers' catch blocks returned normally, which runTier records as
 *     status='completed' — so once the hang was fixed, the failure would have
 *     become INVISIBLE instead of loud.
 *
 * These are source assertions via readCode(), which strips comments — so they
 * cannot be satisfied by the docblocks that describe the fix. That trap has
 * caught this repo 3+ times.
 */
import { describe, it, expect } from "vitest";
import { readCode } from "../testUtils/sourceAssertions";

describe("GSC token exchange is bounded", () => {
  const code = readCode("server/pipelines/gsc-data.ts");

  // The token call gates every other GSC request — nothing runs without it, so
  // an unbounded await here stalls the whole pipeline behind it.
  it("the oauth2 token fetch carries an AbortSignal timeout", () => {
    // Split on fetch( and take the chunk that is the token call. Index-slicing
    // the raw string was brittle — readCode() strips comments, so byte offsets
    // do not survive.
    const tokenChunk = code.split(/\bfetch\(/).find((c) => c.startsWith('"https://oauth2.googleapis.com/token"'));
    expect(tokenChunk, "token fetch not found in gsc-data.ts").toBeDefined();
    expect(tokenChunk!.slice(0, 700)).toMatch(/AbortSignal\.timeout\(/);
  });

  it("leaves no unbounded fetch anywhere in the file", () => {
    // Every fetch( in this file must have a signal within its call expression.
    const chunks = code.split(/\bfetch\(/).slice(1);
    for (const chunk of chunks) {
      expect(chunk.slice(0, 700)).toMatch(/AbortSignal\.timeout\(/);
    }
  });
});

describe("pipeline cron handlers surface their failures", () => {
  const code = readCode("server/cron/scheduler.ts");

  // Returning from a catch is a NORMAL return — runTier writes 'completed'.
  // Adding a timeout without this would have traded a visible failure for a
  // silent one.
  it("gsc-pipeline rethrows instead of returning a 'skipped' success", () => {
    expect(code).not.toContain('return { details: "GSC pipeline skipped" }');
    expect(code).toMatch(/gsc-pipeline FAILED/);
  });

  it("review-pipeline rethrows too", () => {
    expect(code).not.toContain('return { details: "Review pipeline skipped" }');
    expect(code).toMatch(/review-pipeline FAILED/);
  });
});

describe("cron_log records why a job failed", () => {
  const code = readCode("server/cron/scheduler.ts");

  it("logTierJob accepts and writes errorMessage", () => {
    expect(code).toMatch(/errorMessage\?:\s*string/);
    expect(code).toMatch(/errorMessage:\s*errorMessage\?\.slice\(0,\s*2000\)/);
  });

  // The observer reads error_message, not details. A failure logged without it
  // produces an alert that names the job and nothing else.
  it("the failed path passes an error message, not just details", () => {
    const failedCall = code.slice(code.indexOf('logTierJob(job.name, "failed"'));
    expect(failedCall.slice(0, 300)).toMatch(/err\.stack\s*\|\|\s*err\.message/);
  });
});
