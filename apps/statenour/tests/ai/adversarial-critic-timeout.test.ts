/**
 * The adversarial critic's timeout must clear its MEASURED latency (2026-09-23).
 *
 * Same defect as judge-eval (tests/ai/judge-eval-timeout.test.ts): the budget
 * was `timeoutMs: 8_000`. Measured from agent_traces (label
 * 'adversarial-critic', 2026-09-16 to 09-23, n=110, every call succeeded):
 *
 *     p50 = 5.7s   p90 = 14.9s   p95 = 21.7s   p99 = 32.3s
 *
 * 32 of 110 calls outlived the budget. The guardian races the call and never
 * cancels it, so each was billed and discarded, and with `maxRetries: 1` the
 * retry usually timed out too: six "[guardian:adversarial-critic] api_timeout
 * after 2 attempt(s)" on 09-23 against at least four objections kept.
 *
 * The measured figure lives beside the config (ADVERSARIAL_MEASURED_P95_MS), so
 * these assert a RELATIONSHIP, not a restated magic number.
 */
import { describe, it, expect } from "vitest";
import { ADVERSARIAL_GUARDIAN_OPTS, ADVERSARIAL_MEASURED_P95_MS } from "@/lib/ai/adversarial-critic";

/** provider.ts: PROVIDER_TIMEOUT for non-long-form task types (the critic uses "fast"). */
const PROVIDER_TIMEOUT_MS = 45_000;

describe("adversarial-critic guardian budget", () => {
  // POSITIVE CONTROL: if the export vanishes or goes undefined, every
  // comparison below would silently pass on NaN.
  it("the config is actually exported and numeric", () => {
    expect(typeof ADVERSARIAL_GUARDIAN_OPTS.timeoutMs).toBe("number");
    expect(Number.isFinite(ADVERSARIAL_GUARDIAN_OPTS.timeoutMs)).toBe(true);
    expect(ADVERSARIAL_MEASURED_P95_MS).toBeGreaterThan(0);
  });

  // CANARY: the shipped value could not pass.
  it("CANARY: the budget exceeds the MEASURED p95, so 8_000 would fail", () => {
    expect(ADVERSARIAL_GUARDIAN_OPTS.timeoutMs).toBeGreaterThan(ADVERSARIAL_MEASURED_P95_MS);
    expect(8_000).toBeLessThan(ADVERSARIAL_MEASURED_P95_MS);
  });

  // A guardian budget above the provider's own timeout would shadow the
  // provider's failover and turn a recoverable provider timeout into an abort.
  it("stays inside the provider timeout so the provider stays the outer bound", () => {
    expect(ADVERSARIAL_GUARDIAN_OPTS.timeoutMs).toBeLessThan(PROVIDER_TIMEOUT_MS);
  });

  it("keeps a retry, so a transient failure is still recoverable", () => {
    expect(ADVERSARIAL_GUARDIAN_OPTS.maxRetries).toBeGreaterThanOrEqual(1);
  });

  it("stays a reliability-only sub-op (no AI-tool policy or approvals)", () => {
    expect(ADVERSARIAL_GUARDIAN_OPTS.reliabilityOnly).toBe(true);
  });
});
