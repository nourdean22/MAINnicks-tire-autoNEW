/**
 * The prose-aware strict-Done shadow must actually RECORD, and must record a
 * denominator.
 *
 * `compareActionDoneShadow` shipped with tests and zero production call sites,
 * so `legacyStrictGap` — the one number a promotion decision turns on — had
 * never been observed on a real turn. These tests pin the recorder that closes
 * that gap, and specifically pin the two properties that make the resulting
 * data trustworthy:
 *
 *   1. NON-GAP turns are recorded too. Recording only gaps leaves a numerator
 *      with no denominator, and then a measured zero is indistinguishable from
 *      an instrument that never ran. That confusion is exactly what the
 *      tool-surfacing census (#2359) recorded as its own worst failure.
 *   2. A BROKEN instrument reports failure instead of looking like "no gaps".
 *      #2359's `catch { return null }` made an impossible query read as an
 *      empty dataset for three weeks.
 */
import { describe, it, expect, vi } from "vitest";
import {
  recordActionDoneShadow,
  ACTION_DONE_SHADOW_METRIC,
} from "@/lib/ai/receipts/action-done-shadow-recorder";
import type { ActionDoneShadowVerdict } from "@/lib/ai/chat/action-result-verifier";

function verdict(over: Partial<ActionDoneShadowVerdict> = {}): ActionDoneShadowVerdict {
  return {
    completionClaimDetected: true,
    strictRelevant: true,
    legacyDoneEligible: true,
    strictDoneEligible: true,
    legacyStrictGap: false,
    failedMutations: [],
    providerAcceptedMutations: [],
    verifiedMutations: [],
    phantomClaims: [],
    ...over,
  };
}

const CTX = { traceId: "trace-1", conversationId: "conv-1" };

function deps() {
  const recordMetric = vi.fn(async () => {});
  const logInfo = vi.fn();
  const logError = vi.fn();
  return { recordMetric, logInfo, logError };
}

describe("action-done shadow recorder", () => {
  it("does not record when the prose made no completion claim", async () => {
    const d = deps();
    const out = await recordActionDoneShadow(
      verdict({ completionClaimDetected: false }),
      CTX,
      d,
    );
    expect(out).toBe("skipped_no_claim");
    // Turns with no Done-claim are not in the population the promotion
    // question applies to; recording them would bury the signal.
    expect(d.recordMetric).not.toHaveBeenCalled();
  });

  it("DENOMINATOR: records non-gap turns too, with value 0", async () => {
    const d = deps();
    const out = await recordActionDoneShadow(verdict({ legacyStrictGap: false }), CTX, d);

    expect(out).toBe("recorded");
    expect(d.recordMetric).toHaveBeenCalledTimes(1);
    const [metric, value] = d.recordMetric.mock.calls[0];
    expect(metric).toBe(ACTION_DONE_SHADOW_METRIC);
    // 0, not "absent" — this row is what makes a gap RATE computable.
    expect(value).toBe(0);
  });

  it("records a gap turn with value 1", async () => {
    const d = deps();
    const out = await recordActionDoneShadow(
      verdict({ legacyStrictGap: true, legacyDoneEligible: true, strictDoneEligible: false }),
      CTX,
      d,
    );
    expect(out).toBe("recorded");
    expect(d.recordMetric.mock.calls[0][1]).toBe(1);
  });

  it("carries the disagreement CLASSES, not just the boolean", async () => {
    // A promotion decision needs to know WHY legacy and strict disagreed.
    // `providerAccepted` is the load-bearing one: the executor reported
    // success and nothing independently confirmed it.
    const d = deps();
    await recordActionDoneShadow(
      verdict({
        legacyStrictGap: true,
        strictDoneEligible: false,
        failedMutations: ["task.create"],
        providerAcceptedMutations: ["email.send"],
        verifiedMutations: ["note.write"],
      }),
      CTX,
      d,
    );
    const tags = d.recordMetric.mock.calls[0][2]?.tags as Record<string, unknown>;
    expect(tags.providerAcceptedMutations).toEqual(["email.send"]);
    expect(tags.failedMutations).toEqual(["task.create"]);
    expect(tags.verifiedMutations).toEqual(["note.write"]);
    expect(tags.legacyStrictGap).toBe(true);
    expect(tags.strictDoneEligible).toBe(false);
    expect(tags.traceId).toBe("trace-1");
  });

  it("distinguishes 'not evaluable' from 'strict says no'", async () => {
    // strictDoneEligible === null means there was no mutation claim to judge.
    // Collapsing it into false would invent disagreements that never happened.
    const d = deps();
    await recordActionDoneShadow(
      verdict({ strictRelevant: false, strictDoneEligible: null, legacyStrictGap: false }),
      CTX,
      d,
    );
    const tags = d.recordMetric.mock.calls[0][2]?.tags as Record<string, unknown>;
    expect(tags.strictDoneEligible).toBeNull();
    expect(tags.strictRelevant).toBe(false);
  });

  it("a BROKEN instrument reports failure — it must not read as 'no gaps'", async () => {
    const d = deps();
    d.recordMetric.mockRejectedValueOnce(new Error("system_metrics unreachable"));

    const out = await recordActionDoneShadow(verdict({ legacyStrictGap: true }), CTX, d);

    expect(out).toBe("failed");
    // The whole point: silence here would be indistinguishable from a clean run.
    expect(d.logError).toHaveBeenCalledTimes(1);
    expect(String(d.logError.mock.calls[0][0])).toContain("action-done-shadow");
  });

  it("never throws into the turn — a shadow must not be able to break chat", async () => {
    const d = deps();
    d.recordMetric.mockRejectedValueOnce(new Error("boom"));
    await expect(
      recordActionDoneShadow(verdict({ legacyStrictGap: true }), CTX, d),
    ).resolves.toBe("failed");
  });
});
