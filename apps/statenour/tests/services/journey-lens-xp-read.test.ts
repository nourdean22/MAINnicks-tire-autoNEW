/**
 * Brain FU6 (skill empty-vs-error): the Journey lens' XP section is a read with a state.
 *
 * THE DEFECT. buildJourneyLens read both XP windows through xpEventTotalsSince with
 * `.catch(() => new Map())`, so a failed read became `{ current30: 0, prior30: 0 }` with enoughData
 * false: indistinguishable from a quiet month. The lens now reads through xpEventTotalsSinceOrNull
 * and flags the section `unknown: true` (present only then) with growthPct null.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn<(since: Date) => Promise<Map<string, number> | null>>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findMany: async () => [] } },
}));
vi.mock("@/lib/brain/identity-snapshot", () => ({ loadIdentityHistory: async () => [] }));
vi.mock("@/lib/mastery/credit", () => ({
  xpEventTotalsSinceOrNull: (since: Date) => h.read(since),
  // The swallowing reader: a failed read becomes an empty map, exactly like credit.ts.
  xpEventTotalsSince: async (since: Date) => (await h.read(since)) ?? new Map<string, number>(),
}));

import { buildJourneyLens } from "@/lib/services/journey-lens";

const windowDays = (since: Date) => Math.round((Date.now() - since.getTime()) / 86_400_000);

// Braces matter: a returned function is vitest's teardown hook, and would call the mock with no args.
beforeEach(() => {
  h.read.mockReset();
});

describe("buildJourneyLens: the xp section", () => {
  it("flags unknown, with no growth claim, when the 30-day read fails", async () => {
    h.read.mockImplementation(async (s) => (windowDays(s) === 30 ? null : new Map([["focus", 90]])));
    const { xp } = await buildJourneyLens();
    expect(xp.unknown, "a failed 30-day read was drawn as a quiet month").toBe(true);
    expect(xp.data.growthPct).toBeNull();
    expect(xp.enoughData).toBe(false);
  });

  it("flags unknown when the 60-day read fails", async () => {
    h.read.mockImplementation(async (s) => (windowDays(s) === 60 ? null : new Map([["focus", 50]])));
    const { xp } = await buildJourneyLens();
    expect(xp.unknown).toBe(true);
    expect(xp.data.growthPct).toBeNull();
  });

  it("flags unknown when the read rejects outright", async () => {
    h.read.mockRejectedValue(new Error("connection reset"));
    const { xp } = await buildJourneyLens();
    expect(xp.unknown).toBe(true);
    expect(xp.enoughData).toBe(false);
  });

  it("control: a real zero month has no unknown flag (an empty map is a measurement)", async () => {
    h.read.mockResolvedValue(new Map());
    const { xp } = await buildJourneyLens();
    expect("unknown" in xp, "a measured zero was flagged unknown").toBe(false);
    expect(xp.enoughData).toBe(false);
    expect(xp.data).toEqual({ current30: 0, prior30: 0, growthPct: null });
  });

  it("control: real XP in both windows yields totals and growth, no flag", async () => {
    h.read.mockImplementation(async (s) => new Map([["focus", windowDays(s) === 30 ? 150 : 250]]));
    const { xp } = await buildJourneyLens();
    expect("unknown" in xp).toBe(false);
    expect(xp.enoughData).toBe(true);
    expect(xp.data).toEqual({ current30: 150, prior30: 100, growthPct: 50 });
  });
});
