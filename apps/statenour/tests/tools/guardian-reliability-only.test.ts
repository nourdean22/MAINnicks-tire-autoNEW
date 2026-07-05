/**
 * withGuardian · reliabilityOnly opt · v10.0.531
 *
 * Proves the mechanism that unbroke chat web search: an internal sub-op
 * wrapped with { reliabilityOnly: true } SKIPS the AI-tool policy/approval
 * block (evaluateToolAction) entirely and runs ONLY the retry/timeout loop,
 * whereas the default wrapper still enforces the policy. Without this,
 * unregistered sub-op ids (google-search, cohere-rerank, …) were denied
 * "Unknown tool ID" on every call.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockEval } = vi.hoisted(() => ({ mockEval: vi.fn() }));
vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: mockEval,
}));

import { withGuardian } from "@/lib/tools/guardian";

describe("withGuardian · reliabilityOnly", () => {
  beforeEach(() => {
    mockEval.mockReset();
  });

  it("default (no opt) enforces policy — a deny throws before fn runs", async () => {
    mockEval.mockReturnValue({ decision: "deny", reason: "Unknown tool ID: x" });
    const fn = vi.fn(async () => "ran");
    const guarded = withGuardian("x", fn, { maxRetries: 0 });

    await expect(guarded()).rejects.toThrow(/Action denied: Unknown tool ID/);
    expect(fn).not.toHaveBeenCalled();
    expect(mockEval).toHaveBeenCalledOnce();
  });

  it("reliabilityOnly:true skips the policy — fn runs even when policy would deny", async () => {
    mockEval.mockReturnValue({ decision: "deny", reason: "Unknown tool ID: x" });
    const fn = vi.fn(async () => "ran");
    const guarded = withGuardian("x", fn, { maxRetries: 0, reliabilityOnly: true });

    expect(await guarded()).toBe("ran");
    expect(fn).toHaveBeenCalledOnce();
    // The policy engine is never consulted for a reliabilityOnly sub-op.
    expect(mockEval).not.toHaveBeenCalled();
  });

  it("reliabilityOnly:true keeps retry/timeout — recovers a transient failure", async () => {
    mockEval.mockReturnValue({ decision: "deny", reason: "would deny" });
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw new Error("fetch failed");
      return "ok";
    };
    const guarded = withGuardian("x", fn, { maxRetries: 2, reliabilityOnly: true });

    expect(await guarded()).toBe("ok");
    expect(calls).toBe(2);
    expect(mockEval).not.toHaveBeenCalled();
  });
});
