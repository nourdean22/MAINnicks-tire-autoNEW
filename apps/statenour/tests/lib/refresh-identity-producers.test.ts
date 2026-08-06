/**
 * 2026-08-06 · refresh-identity producer parity.
 *
 * WHY THIS EXISTS
 *
 * The Wave-AE prune (2026-05-28) deleted app/api/cron/refresh-identity. It was
 * resurrected on 2026-07-11 — but only PARTIALLY. The pre-prune route ran four
 * producers in one nightly pass; the resurrection restored one and dropped
 * three, silently, for another 26 days:
 *
 *   computeIdentitySnapshot()     restored 2026-07-11
 *   computeQualitativeIdentity()  DROPPED -> the qualitative-identity row froze
 *                                 for ~10 weeks and every chat turn served the
 *                                 stale snapshot as current
 *   harvestBeliefs()              DROPPED -> belief_candidate stayed at 0 rows,
 *                                 so `belief` did too, so the /chat beliefs
 *                                 block fired 0 times in 1,417 measured turns
 *   runDecay()                    dropped, but correctly — /api/cron/data-cleanup
 *                                 already reaps expired rows nightly
 *
 * A PARTIAL restoration is exactly as invisible as a full deletion: the route
 * exists, the cron fires, the fan-out parity test passes, and the response is
 * a 200. Nothing distinguishes "ran and produced" from "ran and skipped three
 * quarters of its job" without asserting the call sites.
 *
 * tests/lib/cron-fanout-parity.test.ts guards the route EXISTING.
 * This file guards the route still DOING ITS JOB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSnapshot = vi.fn();
const mockQualitative = vi.fn();
const mockHarvest = vi.fn();

vi.mock("@/lib/utils/http", () => ({
  // Passthrough — we are testing the handler body, not the auth wrapper.
  cronHandler: (fn: () => Promise<unknown>) => fn,
}));

vi.mock("@/lib/brain/identity-snapshot", () => ({
  computeIdentitySnapshot: () => mockSnapshot(),
}));
vi.mock("@/lib/brain/qualitative-identity", () => ({
  computeQualitativeIdentity: () => mockQualitative(),
}));
vi.mock("@/lib/brain/belief-harvester", () => ({
  harvestBeliefs: () => mockHarvest(),
}));

import { GET } from "@/app/api/cron/refresh-identity/route";

beforeEach(() => {
  mockSnapshot.mockReset().mockResolvedValue({
    computed_at: "2026-08-06T00:00:00.000Z",
    axes: { promise_integrity: { value: 70, manual: null } },
  });
  mockQualitative.mockReset().mockResolvedValue({ values: [] });
  mockHarvest.mockReset().mockResolvedValue({ harvested: 3 });
});

describe("refresh-identity cron · producer parity", () => {
  it("runs ALL of its restored producers, not just the identity snapshot", async () => {
    await (GET as unknown as () => Promise<unknown>)();

    // Each of these is a separate 70-day outage if it silently goes missing
    // again. Assert them individually so a failure names the lost producer.
    expect(mockSnapshot, "computeIdentitySnapshot not called").toHaveBeenCalledTimes(1);
    expect(mockQualitative, "computeQualitativeIdentity not called — qualitative identity will freeze").toHaveBeenCalledTimes(1);
    expect(mockHarvest, "harvestBeliefs not called — belief_candidate stays empty and the beliefs block can never fill").toHaveBeenCalledTimes(1);
  });

  it("keeps each producer fail-soft — one throwing must not lose the others", async () => {
    mockQualitative.mockRejectedValue(new Error("neon blip"));
    mockHarvest.mockRejectedValue(new Error("embedder down"));

    // The original pre-prune route caught each producer to null individually.
    // If that contract is lost, a transient failure in a SECONDARY producer
    // takes down the identity roll too — the one thing this cron must never
    // skip.
    const res = (await (GET as unknown as () => Promise<Record<string, unknown>>)());
    expect(res.ok).toBe(true);
    expect(res.computedAt).toBe("2026-08-06T00:00:00.000Z");
    expect(res.qualitativeRefreshed).toBe(false);
    expect(res.beliefsHarvested).toBeNull();
  });

  it("reports what each producer actually did", async () => {
    const res = (await (GET as unknown as () => Promise<Record<string, unknown>>)());

    // A run that produced nothing should be visible in the cron result, not
    // something you infer from row counts three months later.
    expect(res.qualitativeRefreshed).toBe(true);
    expect(res.beliefsHarvested).toEqual({ harvested: 3 });
  });
});
