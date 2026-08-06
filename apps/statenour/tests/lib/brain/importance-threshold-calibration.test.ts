/**
 * 2026-08-06 · persistIfImportant default-threshold calibration.
 *
 * `chat_importance` held 10 rows in the 3.5 months to 2026-08-06. That single
 * fact starved the contradiction detector: it requires BOTH the fresh row and
 * its neighbour to be chat_importance, >= 7 days apart and >= 0.78 similar, and
 * a 10-row pool cannot produce such a pair. `contradiction` sat at 0 rows and
 * its /chat block fired 0/1417 turns.
 *
 * The default threshold moved 6 -> 4, measured rather than guessed via
 * scripts/calibrate-importance-threshold.ts (runs the real scoreMessage over
 * every prod user message). Over 1,711 messages / 113 days:
 *
 *     threshold 6 -> 2.4 contradiction-eligible rows per month
 *     threshold 4 -> 7.7 per month
 *
 * This file pins the newly-admitted 4-5 band. Reverting the default to 6
 * turns the first test red.
 *
 * It does NOT re-test TTL or tiebreakers — importance-scorer-ttl.test.ts owns
 * those, and it passes explicit thresholds so it is insulated from this change.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { upsert: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: mocks.brainMemory },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })),
  },
}));

import { scoreMessage, persistIfImportant } from "@/lib/brain/importance-scorer";

// One strong signal (decision, weight 3) plus a person mention (weight 1).
// Deliberately under 200 chars so no length bonus, and not a question so no
// -2 penalty — the score comes purely from corroborated signal.
const MID_BAND = "I've decided to go with the cheaper vendor, and Nick agreed it was the right call.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.upsert.mockResolvedValue({ id: "mem-1" });
});

describe("persistIfImportant · default threshold calibration", () => {
  it("persists a mid-band message that the old threshold of 6 rejected", async () => {
    const scored = scoreMessage(MID_BAND);

    // Guard the fixture itself — if the regexes drift, this test should fail
    // loudly rather than silently stop testing the band it claims to.
    expect(scored.score, `fixture must land in the newly-admitted band, got ${scored.score}`)
      .toBeGreaterThanOrEqual(4);
    expect(scored.score).toBeLessThan(6);
    expect(scored.primary).not.toBeNull();

    // DEFAULT threshold — this is the behaviour change.
    const admitted = await persistIfImportant("msg-mid", MID_BAND, "conv-1");
    expect(admitted.persisted, "mid-band message must persist under the calibrated default").toBe(true);
    expect(mocks.brainMemory.upsert).toHaveBeenCalledTimes(1);

    // And prove it is the DEFAULT doing the work: the identical message at the
    // old threshold of 6 is still rejected. Revert the default to 6 and the
    // assertion above fails while this one keeps passing.
    vi.clearAllMocks();
    const rejectedAtOld = await persistIfImportant("msg-mid", MID_BAND, "conv-1", 6);
    expect(rejectedAtOld.persisted).toBe(false);
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("still requires corroboration — a bare single signal does not persist", async () => {
    // "actually" alone is CONTRADICT_RX (weight 3) with nothing supporting it:
    // no second category, no length bonus, no person. Score 3 < 4.
    const bare = "Actually the invoice total was slightly different than that.";
    const scored = scoreMessage(bare);
    expect(scored.score).toBeLessThan(4);

    const res = await persistIfImportant("msg-bare", bare, "conv-1");
    expect(res.persisted, "score-3 single-signal messages must stay out — that is the corroboration bar").toBe(false);
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("still requires a primary category regardless of length", async () => {
    // `primary != null` — not the threshold — is the real gate: only 7.3% of
    // real messages earn a primary. A long message with zero keyword hits
    // maxes out at the +2 length bonus and must never persist.
    const longNoSignal = "x".repeat(600) + " some ordinary prose with no scored keywords in it at all.";
    const scored = scoreMessage(longNoSignal);
    expect(scored.primary).toBeNull();

    const res = await persistIfImportant("msg-long", longNoSignal, "conv-1");
    expect(res.persisted).toBe(false);
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });
});
