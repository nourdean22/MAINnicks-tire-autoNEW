/**
 * A new profile is not a contact (2026-09-16, W6).
 *
 * resolvePersonByName's create tier used to start every profile at
 * interactionCount 1 with lastInteraction = now — one of the three writers
 * that bumped the counters with no ledger row behind them (measured on
 * prod: 7 soft-deleted ghost profiles each carrying exactly that phantom 1).
 * Adding a person to the atlas records nothing in the ledger, so the
 * counters start at 0 / null and only the seam moves them.
 *
 * Positive control: red on the unfixed create (data carried
 * `interactionCount: 1, lastInteraction: <Date>`), green after.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  memoryCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personProfile: { findFirst: m.findFirst, findMany: m.findMany, create: m.create },
    brainMemory: { create: m.memoryCreate },
  },
}));

import { resolvePersonByName } from "@/lib/brain/person-profile-fuzzy";

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.findFirst.mockResolvedValue(null); // tiers 1 + 2: no exact / case-insensitive match
  m.findMany.mockResolvedValue([]); // tiers 3 + 4: nothing to fuzz against
  m.create.mockImplementation(async (args: { data: { name: string } }) => ({ id: "new1", name: args.data.name }));
  m.memoryCreate.mockResolvedValue({ id: "mem" });
});

describe("resolvePersonByName · create tier", () => {
  it("a brand-new profile starts at interactionCount 0 and lastInteraction null", async () => {
    const out = await resolvePersonByName("Zorblax Quill", { role: "friend", source: "agent" });
    expect(out).toEqual({ person: { id: "new1", name: "Zorblax Quill" }, matched: false, matchTier: "created" });
    expect(m.create).toHaveBeenCalledTimes(1);
    const data = m.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({ name: "Zorblax Quill", role: "friend", source: "agent" });
    expect(data.interactionCount).toBe(0);
    expect(data.lastInteraction).toBeNull();
  });

  it("createIfMissing:false still creates nothing", async () => {
    const out = await resolvePersonByName("Zorblax Quill", { createIfMissing: false });
    expect(out).toEqual({ person: null, matched: false, matchTier: "no_match" });
    expect(m.create).not.toHaveBeenCalled();
  });
});
