/**
 * CANARY · the two verified-good properties of the resurface path, pinned so
 * the 2026-09-02 self-audit's fix one layer up (the judged-identity exemption
 * in lib/brain/discoveries.ts) cannot be "completed" by weakening them here.
 *
 *  A · THE RESURFACE WRITE CLEARS COLUMN AND METADATA TOGETHER. Clearing only
 *      `metadata` is what made the entire recurrence policy a no-op once: every
 *      reader in the wave prefers the column, so an escalated spot stayed
 *      filtered out of the feed, out of the exact count and out of the system
 *      prompt while the cron reported `resurfaced: 1`. The module's own note at
 *      that write records it. The fake store models BOTH, because the version
 *      that omitted the columns scored green against a policy that never ran.
 *
 *  B · `shouldResurface` REJECTS A NULL severityRank. Three of the four
 *      engines write no `[TIER]` prefix, so the rank is genuinely absent for
 *      them. Defaulting one would mint a resurface out of nothing AND write a
 *      history entry whose `severityRank` cannot index SEVERITY_WORD in
 *      discover-tab — rendering "severity rose from undefined to critical".
 *      The refusal is what keeps that lookup total (bound to the array in
 *      tests/components/brain/discover-empty-state.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  remember: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: mocks.remember },
}));

import type { BlindSpot } from "@/lib/brain/blind-spot-detector";
import {
  SEVERITY_RANK,
  persistBlindSpot,
  shouldResurface,
} from "@/lib/brain/blind-spot-identity";

const spot = (over: Partial<BlindSpot> = {}): BlindSpot => ({
  domain: "general",
  description: "9 decisions awaiting review",
  severity: "critical",
  evidence: "Oldest is 14 days old",
  daysSinceAttention: 14,
  suggestedAction: "Triage the queue",
  ...over,
});

/** The row as it stands after the operator rated it `noise` at HIGH. */
const standing = {
  id: "row-1",
  deletedAt: null,
  lastSeen: new Date("2026-08-25T00:00:00Z"),
  metadata: {
    discoveryVerdict: "noise",
    discoveryVerdictSeverityRank: SEVERITY_RANK.high,
    discoveryRatedAt: "2026-08-25T00:00:00.000Z",
  },
};

describe("CANARY · a resurface clears the column and the metadata together", () => {
  beforeEach(() => {
    for (const fn of [mocks.brainMemory.findUnique, mocks.brainMemory.findMany, mocks.brainMemory.update, mocks.remember]) {
      fn.mockReset();
    }
    mocks.remember.mockResolvedValue({});
    mocks.brainMemory.update.mockResolvedValue({});
    mocks.brainMemory.findMany.mockResolvedValue([]);
  });

  it("BREAKS: escalating past the rated tier nulls BOTH mirrors, and records the history", async () => {
    mocks.brainMemory.findUnique
      .mockResolvedValueOnce(standing) // pre-read, by (category, key)
      .mockResolvedValueOnce({ metadata: standing.metadata, lastSeen: new Date() }); // re-read

    const res = await persistBlindSpot(spot()); // critical > high

    expect(res.resurfaced).toBe(true);
    const data = mocks.brainMemory.update.mock.calls[0][0].data;

    // The COLUMN — the half whose omission made the policy a no-op.
    expect(data.discoveryVerdict).toBeNull();
    expect(data.discoveryRatedAt).toBeNull();
    // The METADATA source, in the same write.
    expect(data.metadata.discoveryVerdict).toBeNull();
    expect(data.metadata.discoveryVerdictSeverityRank).toBeNull();
    // And the evidence the operator-facing banner needs to justify re-asking.
    expect(data.metadata.discoveryVerdictHistory).toEqual([
      { verdict: "noise", at: "2026-08-25T00:00:00.000Z", severityRank: SEVERITY_RANK.high },
    ]);
    expect(data.metadata.discoveryResurfacedFromRank).toBe(SEVERITY_RANK.high);
    expect(data.metadata.discoveryResurfacedToRank).toBe(SEVERITY_RANK.critical);
  });

  it("positive control: NO escalation leaves the verdict standing on both mirrors", async () => {
    // Re-emitting at the SAME tier must not clear anything — otherwise every
    // nightly run would resurface every suppressed spot, which is the alert
    // fatigue the policy exists to avoid.
    mocks.brainMemory.findUnique
      .mockResolvedValueOnce(standing)
      .mockResolvedValueOnce({ metadata: standing.metadata, lastSeen: new Date() });

    const res = await persistBlindSpot(spot({ severity: "high" }));

    expect(res.resurfaced).toBe(false);
    const data = mocks.brainMemory.update.mock.calls[0][0].data;
    expect("discoveryVerdict" in data).toBe(false);
    expect(data.metadata.discoveryVerdict).toBe("noise");
    expect(data.metadata.discoveryVerdictHistory).toBeUndefined();
  });
});

describe("CANARY · shouldResurface refuses to invent a severity rank", () => {
  it("BREAKS: a null rated-rank never resurfaces, at any current severity", () => {
    for (const severity of ["low", "medium", "high", "critical"] as const) {
      expect(shouldResurface("noise", null, severity)).toBe(false);
    }
  });

  it("BREAKS: a null rank therefore writes no history entry to render from", async () => {
    // The end-to-end consequence, not just the predicate: with no rank on the
    // row there is no `severityRank` for SEVERITY_WORD to index, so the write
    // must not manufacture one.
    for (const fn of [mocks.brainMemory.findUnique, mocks.brainMemory.findMany, mocks.brainMemory.update, mocks.remember]) {
      fn.mockReset();
    }
    mocks.remember.mockResolvedValue({});
    mocks.brainMemory.update.mockResolvedValue({});
    mocks.brainMemory.findMany.mockResolvedValue([]);
    const noRank = {
      ...standing,
      metadata: { discoveryVerdict: "noise", discoveryRatedAt: "2026-08-25T00:00:00.000Z" },
    };
    mocks.brainMemory.findUnique
      .mockResolvedValueOnce(noRank)
      .mockResolvedValueOnce({ metadata: noRank.metadata, lastSeen: new Date() });

    const res = await persistBlindSpot(spot({ severity: "critical" }));

    expect(res.resurfaced).toBe(false);
    const data = mocks.brainMemory.update.mock.calls[0][0].data;
    expect(data.metadata.discoveryVerdictHistory).toBeUndefined();
    expect(data.metadata.discoveryVerdict).toBe("noise");
  });

  it("positive control: `known` is exempt, `noise` is not — a real escalation still fires", () => {
    expect(shouldResurface("noise", SEVERITY_RANK.medium, "critical")).toBe(true);
    expect(shouldResurface("known", SEVERITY_RANK.medium, "critical")).toBe(false);
    expect(shouldResurface("investigate", SEVERITY_RANK.medium, "critical")).toBe(false);
    expect(shouldResurface("noise", SEVERITY_RANK.critical, "critical")).toBe(false);
  });
});
