/**
 * Nudge trend-arrow regression (2026-08-12).
 *
 * Every AXIS_NUDGE_TEXT phraser hardcoded "(↓)" regardless of the axis's
 * ACTUAL computed direction — a prod snapshot the same day showed
 * promise_integrity and reflection_cadence both at `direction: "stable"`
 * (pinned at their floor, not declining) while the nudge text claimed a
 * decline every single morning. The arrow must now derive from the real
 * field: falling → (↓), rising → (↑), stable → no arrow. Also locks the
 * promise_integrity phrasing off the dead "/commitments" route.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadIdentitySnapshot: vi.fn(),
  countUnresolved: vi.fn(),
  loadGhostAccuracy: vi.fn(),
  loadActiveSkills: vi.fn(),
  loadPendingSkills: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  redisGet: vi.fn(),
}));

vi.mock("@/lib/brain/identity-snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/identity-snapshot")>();
  return { ...actual, loadIdentitySnapshot: mocks.loadIdentitySnapshot };
});
vi.mock("@/lib/brain/contradiction-surfacer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/contradiction-surfacer")>();
  return { ...actual, countUnresolved: mocks.countUnresolved };
});
vi.mock("@/lib/brain/embedding-utils", () => ({ semanticSearch: vi.fn() }));
vi.mock("@/lib/brain/ghost-nick", () => ({ loadGhostAccuracy: mocks.loadGhostAccuracy }));
vi.mock("@/lib/brain/skill-extractor", () => ({
  loadActiveSkills: mocks.loadActiveSkills,
  loadPendingSkills: mocks.loadPendingSkills,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
  },
}));
vi.mock("@/lib/utils/redis", () => ({
  redisGet: mocks.redisGet,
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  redisDelPrefix: vi.fn(),
}));

import { computeNudges } from "@/lib/brain/cross-system-nudge";
import { invalidate } from "@/lib/utils/cache";
import type { IdentitySnapshot } from "@/lib/brain/identity-snapshot";

function snapshotWith(
  promiseDirection: "rising" | "falling" | "stable",
  promiseValue = 0,
): IdentitySnapshot {
  const axis = (value: number, direction: "rising" | "falling" | "stable") => ({
    value,
    manual: null,
    direction,
    evidence: [],
    updated_at: new Date().toISOString(),
  });
  return {
    axes: {
      velocity: axis(70, "stable"),
      patience_horizon: axis(70, "stable"),
      promise_integrity: axis(promiseValue, promiseDirection),
      dopamine_discipline: axis(70, "stable"),
      business_vs_personal: axis(70, "stable"),
      risk_appetite: axis(70, "stable"),
      social_battery: axis(70, "stable"),
      reflection_cadence: axis(70, "stable"),
    },
    computed_at: new Date().toISOString(),
    data_horizon_days: 30,
  };
}

beforeEach(() => {
  invalidate("brain_nudges_v1");
  // cached()'s L2 check is `fromRedis !== null` — an unconfigured vi.fn()
  // resolves `undefined`, which is !== null, so cached() reads it as a
  // Redis HIT of value undefined and returns that instead of computing.
  // Must explicitly mock a miss.
  mocks.redisGet.mockResolvedValue(null);
  mocks.countUnresolved.mockResolvedValue(0);
  mocks.loadGhostAccuracy.mockResolvedValue(null);
  mocks.loadActiveSkills.mockResolvedValue([]);
  mocks.loadPendingSkills.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([]);
  mocks.findUnique.mockResolvedValue(null);
});

describe("promise_integrity nudge — real trend arrow, honest link", () => {
  it("shows NO arrow when direction is stable (prod case: value pinned at floor, not declining)", async () => {
    mocks.loadIdentitySnapshot.mockResolvedValue(snapshotWith("stable"));
    const nudges = await computeNudges();
    const promise = nudges.find((n) => n.text.startsWith("promise integrity"));
    expect(promise).toBeDefined();
    expect(promise!.text).not.toContain("↓");
    expect(promise!.text).not.toContain("↑");
  });

  it("shows (↓) only when direction is genuinely falling", async () => {
    mocks.loadIdentitySnapshot.mockResolvedValue(snapshotWith("falling"));
    const nudges = await computeNudges();
    const promise = nudges.find((n) => n.text.startsWith("promise integrity"));
    expect(promise!.text).toContain("(↓)");
  });

  it("shows (↑) when direction is rising (still below the weakness floor)", async () => {
    mocks.loadIdentitySnapshot.mockResolvedValue(snapshotWith("rising", 40));
    const nudges = await computeNudges();
    const promise = nudges.find((n) => n.text.startsWith("promise integrity"));
    expect(promise!.text).toContain("(↑)");
  });

  it("never claims the nonexistent /commitments route", async () => {
    mocks.loadIdentitySnapshot.mockResolvedValue(snapshotWith("stable"));
    const nudges = await computeNudges();
    const promise = nudges.find((n) => n.text.startsWith("promise integrity"));
    expect(promise!.text).not.toContain("/commitments");
    expect(promise!.text.toLowerCase()).toContain("pulse feed");
  });
});
