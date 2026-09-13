import { describe, expect, it } from "vitest";
import { retryPolicyFor } from "@/lib/ai/chat/operation-retry-policy";

describe("operation retry policy", () => {
  it("never retries UNKNOWN_COMPLETION before reconciliation", () => {
    const p = retryPolicyFor("UNKNOWN_COMPLETION", "write");
    expect(p.decision).toBe("RECONCILE_BEFORE_RETRY");
    expect(p.mayRetryNow).toBe(false);
    expect(p.mayClaimDone).toBe(false);
    expect(p.requiresReconciliation).toBe(true);
  });

  it("does not promote provider acceptance into a done claim", () => {
    const p = retryPolicyFor("PROVIDER_ACCEPTED", "write");
    expect(p.decision).toBe("VERIFY_BEFORE_CLAIM");
    expect(p.mayClaimDone).toBe(false);
    expect(p.mayRetryNow).toBe(false);
  });

  it("verified operations cannot be replayed and may be claimed done", () => {
    const p = retryPolicyFor("VERIFIED", "write");
    expect(p.decision).toBe("DO_NOT_RETRY");
    expect(p.mayRetryNow).toBe(false);
    expect(p.mayClaimDone).toBe(true);
  });

  it("known read failures may retry under a bounded caller policy", () => {
    const p = retryPolicyFor("FAILED_KNOWN", "read");
    expect(p.decision).toBe("MAY_RETRY");
    expect(p.mayRetryNow).toBe(true);
    expect(p.requiresReconciliation).toBe(false);
  });

  it("known write failures may retry only with stable operation identity", () => {
    const p = retryPolicyFor("FAILED_KNOWN", "write");
    expect(p.decision).toBe("MAY_RETRY");
    expect(p.mayRetryNow).toBe(true);
    expect(p.reason).toMatch(/same durable operation\/idempotency identity/i);
  });

  it("unknown-effect failures fail closed to reconciliation", () => {
    const p = retryPolicyFor("FAILED_KNOWN", "unknown");
    expect(p.decision).toBe("RECONCILE_BEFORE_RETRY");
    expect(p.mayRetryNow).toBe(false);
  });
});
