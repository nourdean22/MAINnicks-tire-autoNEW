/**
 * withGuardian · durable capability receipt · 2026-10-02 · full-circle Lane A
 *
 * Before this, a guardian terminal failure was a log line, an in-memory
 * breaker and a thrown error. Railway showed `guardian_call_failed` for
 * `firecrawl-scrape` (insufficient credits) all day while the Owner Panel had
 * no source to read. Pinned here: exactly one receipt per terminal failure
 * carrying the tool, the failure class and the error text; a success records a
 * recovery; a retried call that recovers records no failure; and a recorder
 * that throws never masks the caller's failure or success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEval, failure, recovery } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  failure: vi.fn(),
  recovery: vi.fn(),
}));

vi.mock("@/lib/tools/tool-policy", () => ({ evaluateToolAction: mockEval }));
vi.mock("@/lib/system/capability-health", () => ({
  recordCapabilityFailure: (...a: unknown[]) => failure(...a),
  recordCapabilityRecovery: (...a: unknown[]) => recovery(...a),
}));

import { withGuardian, __resetGuardianBreakers } from "@/lib/tools/guardian";

beforeEach(() => {
  failure.mockReset();
  recovery.mockReset();
  failure.mockResolvedValue(undefined);
  recovery.mockResolvedValue(undefined);
  __resetGuardianBreakers();
});

describe("withGuardian · capability receipts", () => {
  it("a terminal failure writes one receipt with the tool, its failure class and the error text, then still throws", async () => {
    const guarded = withGuardian(
      "firecrawl-scrape",
      async () => {
        throw new Error("Insufficient credits to perform this request.");
      },
      { maxRetries: 0, reliabilityOnly: true },
    );
    await expect(guarded()).rejects.toBeInstanceOf(Error);
    expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0][0]).toMatchObject({
      toolName: "firecrawl-scrape",
      error: expect.stringContaining("Insufficient credits"),
    });
    expect(typeof failure.mock.calls[0][0].category).toBe("string");
    expect(recovery).not.toHaveBeenCalled();
  });

  it("a success records a recovery and no failure", async () => {
    const guarded = withGuardian("firecrawl-scrape", async () => "ok", { maxRetries: 0, reliabilityOnly: true });
    expect(await guarded()).toBe("ok");
    expect(recovery).toHaveBeenCalledWith("firecrawl-scrape");
    expect(failure).not.toHaveBeenCalled();
  });

  it("a retried call that recovers is not a terminal failure — no receipt, one recovery", async () => {
    let n = 0;
    const guarded = withGuardian(
      "x",
      async () => {
        n++;
        if (n === 1) throw new Error("fetch failed");
        return "ok";
      },
      { maxRetries: 2, reliabilityOnly: true },
    );
    expect(await guarded()).toBe("ok");
    expect(failure).not.toHaveBeenCalled();
    expect(recovery).toHaveBeenCalledOnce();
  });

  it("a recorder that throws never masks the caller's failure, nor the caller's success", async () => {
    failure.mockRejectedValue(new Error("db down"));
    recovery.mockRejectedValue(new Error("db down"));
    const failing = withGuardian(
      "x",
      async () => {
        throw new Error("the real error");
      },
      { maxRetries: 0, reliabilityOnly: true },
    );
    await expect(failing()).rejects.not.toThrow(/db down/);
    await expect(failing()).rejects.toBeInstanceOf(Error);
    const succeeding = withGuardian("y", async () => 42, { maxRetries: 0, reliabilityOnly: true });
    expect(await succeeding()).toBe(42);
  });
});
