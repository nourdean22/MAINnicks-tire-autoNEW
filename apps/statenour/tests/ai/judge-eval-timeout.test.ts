/**
 * judge-eval's timeout must clear its MEASURED latency, not a guess.
 *
 * WHY THIS FILE EXISTS. The budget was `timeoutMs: 8_000` — an override BELOW
 * the guardian's own 30s default, evidently assuming the call is quick. Measured
 * over 7 days of production `.doGenerate` spans (n=26):
 *
 *     p50 = 12.1s   p90 = 25.1s   p95 = 30.0s   p99 = 40.9s
 *
 * More than HALF of all attempts exceeded the budget by construction. With
 * `maxRetries: 1` both attempts usually blew it, producing
 * `[guardian:judge-eval] api_timeout after 2 attempt(s)` — 20 hard failures in
 * 7d and the single largest fault cluster in `error_logs`.
 *
 * ★ A TIMEOUT IS A CLAIM ABOUT LATENCY. Writing one without measuring the
 *   distribution is a guess that fails silently and reads as a provider fault.
 *
 * ⚠ The measured figure lives in `JUDGE_MEASURED_P95_MS` beside the config, so
 * this asserts a RELATIONSHIP rather than restating a magic number: a future
 * edit that tightens the budget under the measured p95 turns this red.
 */
import { describe, it, expect } from "vitest";
import { JUDGE_GUARDIAN_OPTS, JUDGE_MEASURED_P95_MS } from "@/lib/ai/judge-eval";

/** provider.ts: PROVIDER_TIMEOUT for non-long-form task types. */
const PROVIDER_TIMEOUT_MS = 45_000;

describe("judge-eval guardian budget", () => {
  // POSITIVE CONTROL — if the export vanishes or goes undefined, every
  // comparison below would silently pass on NaN.
  it("the config is actually exported and numeric", () => {
    expect(typeof JUDGE_GUARDIAN_OPTS.timeoutMs).toBe("number");
    expect(Number.isFinite(JUDGE_GUARDIAN_OPTS.timeoutMs)).toBe(true);
    expect(JUDGE_MEASURED_P95_MS).toBeGreaterThan(0);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The shipped value. 8s against a 12.1s median meant most calls timed out
  // before doing anything wrong.
  it("CANARY — the budget exceeds the MEASURED p95, so 8_000 would fail", () => {
    expect(JUDGE_GUARDIAN_OPTS.timeoutMs).toBeGreaterThan(JUDGE_MEASURED_P95_MS);
    expect(8_000).toBeLessThan(JUDGE_MEASURED_P95_MS); // the old value could not have passed
  });

  // The provider's own timeout must remain the OUTER bound. A guardian budget
  // above it would shadow the provider's failover and turn a recoverable
  // provider timeout into a guardian abort.
  it("stays inside the provider timeout so the provider stays the outer bound", () => {
    expect(JUDGE_GUARDIAN_OPTS.timeoutMs).toBeLessThan(PROVIDER_TIMEOUT_MS);
  });

  it("keeps a retry, so a transient failure is still recoverable", () => {
    expect(JUDGE_GUARDIAN_OPTS.maxRetries).toBeGreaterThanOrEqual(1);
  });

  // Two attempts at the full budget must not exceed a sane ceiling for
  // fire-and-forget work — judgeReplyAsync is post-stream and awaited by nobody,
  // but unbounded background work is still a cost.
  it("worst-case total background time stays bounded", () => {
    const attempts = JUDGE_GUARDIAN_OPTS.maxRetries + 1;
    expect(JUDGE_GUARDIAN_OPTS.timeoutMs * attempts).toBeLessThanOrEqual(90_000);
  });
});
