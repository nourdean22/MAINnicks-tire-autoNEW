/**
 * Canaries · counter-intuitive stable identity (learning-loops wave
 * 2026-08-28, docs/LEARNING-LOOPS-2026-08-28.md gap 1).
 *
 * The key was `ci_${category}_${Date.now()}` — the clock-key defect the
 * 08-22 wave fixed for blind_spot, still live here: every cron run minted a
 * NEW unjudged row, so a verdict was erased by the next regeneration. These
 * pin (a) key stability across regenerations, and (b) the TTL-trap
 * reconcile — the 08-22 postmortem proved a stable key ALONE is worse than
 * the bug (probation TTL + frozen seenCount + tombstone burn).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  remember: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findUnique: mocks.findUnique, update: mocks.update } },
}));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: mocks.remember },
}));
vi.mock("@/lib/brain/legacy-shims", () => ({
  recentScoreSnapshots: vi.fn(),
  recentShopJobs: vi.fn(),
  recentShopLeads: vi.fn(),
  recentShopQuotes: vi.fn(),
}));

import {
  counterIntuitiveIdentity,
  counterIntuitiveKey,
  persistCounterIntuitive,
  type CounterIntuitive,
} from "@/lib/brain/counter-intuitive";

const finding = (over: Partial<CounterIntuitive> = {}): CounterIntuitive => ({
  assumption: "Fastest response wins",
  reality: "15-60 min responses convert at 45% vs instant at 38%",
  dataPoints: 40,
  impact: "Instant responses may feel automated.",
  category: "response_timing",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remember.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({});
});

describe("counterIntuitiveKey · stability", () => {
  it("BREAKS: the same finding on two different days produces the SAME key", () => {
    // The old key interpolated Date.now() — two runs could never collide, so
    // a verdict never bound the regenerated row. Identity must be content-
    // derived: same category+assumption => same key regardless of when.
    const k1 = counterIntuitiveKey(finding());
    const k2 = counterIntuitiveKey(finding({ reality: "different percentages this week", dataPoints: 99 }));
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^ci_response_timing_[0-9a-f]{16}$/);
  });

  it("different assumptions produce different keys (no over-merge)", () => {
    expect(counterIntuitiveKey(finding())).not.toBe(
      counterIntuitiveKey(finding({ assumption: "Bigger quotes convert less" })),
    );
  });

  it("leading-digit runs collapse; interior digits do not (the 08-22 normalisation rule)", () => {
    expect(counterIntuitiveIdentity(finding({ assumption: "4 leads go cold weekly" }))).toBe(
      counterIntuitiveIdentity(finding({ assumption: "9 leads go cold weekly" })),
    );
    expect(counterIntuitiveIdentity(finding({ assumption: "Order 4 winter tires" }))).not.toBe(
      counterIntuitiveIdentity(finding({ assumption: "Order 6 winter tires" })),
    );
  });
});

describe("persistCounterIntuitive · the TTL-trap reconcile", () => {
  it("first sighting: creates via remember(), keeps probation (no reconcile update)", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await persistCounterIntuitive(finding());
    expect(res.action).toBe("created");
    expect(mocks.remember).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("BREAKS: second sighting clears the probation TTL and refreshes lastSeen", async () => {
    // remember()'s gateway returns noop/update on a re-sighting and NEITHER
    // clears the create-arm expiresAt nor moves lastSeen — without this
    // reconcile the row is GC'd by pruneNoise within 24h (postmortem step 3).
    mocks.findUnique.mockResolvedValue({ id: "m1", deletedAt: null });
    const res = await persistCounterIntuitive(finding());
    expect(res.action).toBe("reinforced");
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.expiresAt).toBeNull();
    expect(data.lastSeen).toBeInstanceOf(Date);
  });

  it("BREAKS: a tombstoned identity is revived, not burned", async () => {
    // findUnique deliberately does not filter deletedAt: a tombstone still
    // answers as `existing`, and without the revive the identity is burned
    // forever (postmortem step 4).
    mocks.findUnique.mockResolvedValue({ id: "m1", deletedAt: new Date("2026-08-20") });
    const res = await persistCounterIntuitive(finding());
    expect(res.revived).toBe(true);
    expect(mocks.update.mock.calls[0][0].data.deletedAt).toBeNull();
  });
});
