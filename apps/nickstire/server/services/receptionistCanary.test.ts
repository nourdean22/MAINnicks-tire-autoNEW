/**
 * Receptionist canary (self-learning W3, 2026-10-31).
 *
 * After an auto-promotion the canary compares the success share of evaluated
 * calls that heard the new prompt (per-call nickPromptHash) against the 14 days
 * before the promotion. Pre-registered: the metric, the harm test, the sample
 * floor and the deadline are constants here, never tuned after the fact.
 * Benchmarked against LaunchDarkly guarded rollouts (sequential regression
 * test, rollback when the sample is too small by the end) and Argo Rollouts
 * (an inconclusive analysis never promotes).
 */
import { describe, expect, it } from "vitest";
import { CANARY, evaluateCanary } from "./receptionistCanary";

const H = 3_600_000;
const at = new Date("2026-11-03T06:00:00Z");
const promotedAt = new Date(at.getTime() - 48 * H);

const counts = (n: number, success: number) => ({ evaluated: n, success });

describe("evaluateCanary", () => {
  it("not enough calls yet, inside the window: keep watching", () => {
    const v = evaluateCanary({ now: at, promotedAt, before: counts(400, 200), after: counts(30, 14) });
    expect(v).toMatchObject({ verdict: "watching" });
  });

  it("enough calls and no harm: the canary passes and the promotion stands", () => {
    const v = evaluateCanary({ now: at, promotedAt, before: counts(400, 200), after: counts(CANARY.minCalls, 31) });
    expect(v).toMatchObject({ verdict: "passed" });
  });

  it("enough calls and a reliable drop in the success share: roll back", () => {
    const v = evaluateCanary({ now: at, promotedAt, before: counts(400, 200), after: counts(CANARY.minCalls, 18) });
    expect(v).toMatchObject({ verdict: "rollback", reason: "harm" });
  });

  it("a severe early drop rolls back before the sample floor", () => {
    const v = evaluateCanary({ now: at, promotedAt, before: counts(400, 200), after: counts(25, 2) });
    expect(v).toMatchObject({ verdict: "rollback", reason: "early_harm" });
  });

  it("a small dip inside noise is not harm", () => {
    const v = evaluateCanary({ now: at, promotedAt, before: counts(400, 200), after: counts(CANARY.minCalls, 27) });
    expect(v.verdict).toBe("passed");
  });

  it("the deadline passes with too few calls: roll back, never keep an unproven prompt", () => {
    const late = new Date(promotedAt.getTime() + CANARY.maxDays * 24 * H + 1);
    expect(evaluateCanary({ now: late, promotedAt, before: counts(400, 200), after: counts(CANARY.minCalls - 1, 40) })).toMatchObject({
      verdict: "rollback",
      reason: "too_few_calls",
    });
  });

  it("no baseline to compare against (too few evaluated calls before): roll back, unmeasurable", () => {
    expect(evaluateCanary({ now: at, promotedAt, before: counts(10, 5), after: counts(CANARY.minCalls, 31) })).toMatchObject({
      verdict: "rollback",
      reason: "no_baseline",
    });
  });

  it("an unreadable count is never read as zero: hold the canary open (watching), never pass", () => {
    expect(evaluateCanary({ now: at, promotedAt, before: null, after: counts(CANARY.minCalls, 31) })).toMatchObject({ verdict: "unknown" });
    expect(evaluateCanary({ now: at, promotedAt, before: counts(400, 200), after: null })).toMatchObject({ verdict: "unknown" });
  });
});
