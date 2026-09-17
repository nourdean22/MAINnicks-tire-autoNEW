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
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  // Returns a RECEIPT, matching `recordMetricStrict`. The mock used to resolve
  // `void`, which quietly diverged from the production dependency: prod passed
  // the fail-soft `recordMetric`, whose `.catch(() => {})` means it can never
  // reject — so the "instrument broken" test below was agreeing with a mock
  // that behaved unlike the real thing. The receipt type now makes the
  // fail-soft writer unassignable, so the two cannot drift apart again.
  const recordMetric = vi.fn(async () => ({ id: "metric-row-1" }));
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

/**
 * The ZERO-ACTION turn, which review caught as a P1 and which the first wiring
 * silently excluded.
 *
 * The call site sat inside `if (actions.length > 0)`, so a turn that claimed
 * completion while emitting NO action block never reached the recorder. That is
 * the phantom shape — "Done — both profiles created" with nothing attempted —
 * and it is the population `phantomClaims` exists to classify. The dataset
 * therefore excluded exactly the fabrications it was built to measure, while
 * the module documented a denominator of ALL completion-claim turns.
 *
 * The recorder itself was always willing; nothing about it needed to change.
 * What these pin is that an empty result list is a first-class input, so a
 * future refactor cannot quietly reintroduce the has-actions-only shape and
 * still look correct from inside this file.
 */
describe("zero-action turns are in the denominator", () => {
  it("records a completion claim that fired NO actions at all", async () => {
    const d = deps();
    // What compareActionDoneShadow([], text) yields for a phantom: the prose
    // claimed Done, strict verification has nothing to stand on, no mutation
    // of any kind was attempted.
    const out = await recordActionDoneShadow(
      verdict({
        legacyDoneEligible: true,
        strictDoneEligible: false,
        legacyStrictGap: true,
        phantomClaims: [{ verb: "created", snippet: "Done — both profiles created", expectedTool: null }] as never,
      }),
      CTX,
      d,
    );

    expect(out).toBe("recorded");
    expect(d.recordMetric).toHaveBeenCalledTimes(1);
    const [metric, value, opts] = d.recordMetric.mock.calls[0];
    expect(metric).toBe(ACTION_DONE_SHADOW_METRIC);
    expect(value).toBe(1);
    const tags = opts?.tags as Record<string, unknown>;
    expect(tags.phantomCount).toBe(1);
    // No mutations were attempted, which is the signature of the phantom case
    // and must be distinguishable from "mutations ran and failed".
    expect(tags.failedMutations).toEqual([]);
    expect(tags.providerAcceptedMutations).toEqual([]);
    expect(tags.verifiedMutations).toEqual([]);
  });

  it("WIRING: the caller invokes the recorder on BOTH arms, not just has-actions", () => {
    // Honest about what this is. The tests above prove the RECORDER accepts an
    // empty result list; none of them can prove the CALL SITE reaches it,
    // because `runDeferredBackgroundWork` is a ~700-line function with no
    // harness — which is why the recorder was extracted at all. So the
    // regression that review actually caught would slip past every assertion
    // in this file.
    //
    // This is therefore a WIRING guard, not a behaviour guard: it checks that
    // two call expressions survive, one of them under a zero-action branch.
    // Matching a CALL EXPRESSION on COMMENT-STRIPPED source is the repo's own
    // remedy for guards a mere mention could satisfy — the prose above names
    // `recordActionDoneShadow` several times and must not count.
    const src = readFileSync(
      join(process.cwd(), "lib/services/chat/deferred-background-work.ts"),
      "utf8",
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");

    const calls = code.match(/recordActionDoneShadow\(/g) ?? [];
    expect(calls.length, "expected a call on each arm — has-actions AND zero-action").toBe(2);
    expect(
      code,
      "the zero-action arm must guard on an empty action list, or the phantom case is excluded again",
    ).toMatch(/actions\.length === 0[\s\S]{0,400}recordActionDoneShadow\(/);
    // And it must pass an EMPTY result list, not the executed results — which
    // do not exist yet on that arm, since withErrorCapture is not awaited.
    expect(code).toMatch(/compareActionDoneShadow\(\s*\[\]\s*,/);
  });

  it("still records a zero-action turn whose claim turned out CLEAN", async () => {
    // The denominator half: a non-gap zero-action turn has to land too, or the
    // phantom rate is computed over gaps alone.
    const d = deps();
    const out = await recordActionDoneShadow(
      verdict({ strictRelevant: false, strictDoneEligible: null, legacyStrictGap: false }),
      CTX,
      d,
    );
    expect(out).toBe("recorded");
    expect(d.recordMetric.mock.calls[0][1]).toBe(0);
  });
});
