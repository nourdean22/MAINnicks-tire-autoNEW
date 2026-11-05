/**
 * The one nickname writer. metadata is a whole JSON object the people engine stamps, so the write is a swap on the
 * object it read: a lost swap re-reads once, and no key beside `nicknames` is ever dropped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  people: [] as Array<{ id: string; name: string; metadata: unknown }>,
  findMany: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { personProfile: { findMany: h.findMany, update: h.update } },
}));

import { editNicknames } from "@/lib/services/people/nicknames";

const lost = Object.assign(new Error("gone"), { code: "P2025" });

beforeEach(() => {
  vi.resetAllMocks();
  h.people = [{ id: "y", name: "Yummah", metadata: { enrichTriedAt: "2026-11-01", nicknames: ["ma"] } }];
  h.findMany.mockImplementation(async () => h.people);
  h.update.mockResolvedValue({ id: "y" });
});

describe("editNicknames", () => {
  it("adds, keeping every other metadata key, swapped on the object it read", async () => {
    const r = await editNicknames("y", { add: ["mom"] });
    expect(r).toEqual({ nicknames: ["ma", "mom"], dead: [] });
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "y", metadata: { equals: { enrichTriedAt: "2026-11-01", nicknames: ["ma"] } } },
      data: { metadata: { enrichTriedAt: "2026-11-01", nicknames: ["ma", "mom"] } },
    });
  });

  it("removes in any case", async () => {
    expect((await editNicknames("y", { remove: ["MA"] })).nicknames).toEqual([]);
  });

  it("writes onto a profile with null metadata", async () => {
    h.people = [{ id: "y", name: "Yummah", metadata: null }];
    await editNicknames("y", { add: ["mom"] });
    const arg = h.update.mock.calls[0][0] as { data: { metadata: unknown } };
    expect(arg.data.metadata).toEqual({ nicknames: ["mom"] });
  });

  it("a lost swap re-reads and lands on the newer object", async () => {
    h.update.mockRejectedValueOnce(lost);
    h.findMany
      .mockResolvedValueOnce(h.people)
      .mockResolvedValueOnce([{ id: "y", name: "Yummah", metadata: { enrichTriedAt: "2026-11-05", nicknames: ["ma"] } }]);
    await editNicknames("y", { add: ["mom"] });
    const second = h.update.mock.calls[1][0] as { data: { metadata: Record<string, unknown> } };
    expect(second.data.metadata).toEqual({ enrichTriedAt: "2026-11-05", nicknames: ["ma", "mom"] });
  });

  it("two lost swaps throw: a save he can see failed, never a quiet drop", async () => {
    h.update.mockRejectedValue(lost);
    await expect(editNicknames("y", { add: ["mom"] })).rejects.toThrow(/try again/i);
    expect(h.update).toHaveBeenCalledTimes(2);
  });

  it("another failure throws as it is, on the first try", async () => {
    h.update.mockRejectedValue(new Error("db down"));
    await expect(editNicknames("y", { add: ["mom"] })).rejects.toThrow("db down");
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it("an unknown or deleted person throws", async () => {
    await expect(editNicknames("nope", { add: ["mom"] })).rejects.toThrow(/not found/i);
  });

  it("no change, no write; his own name is not a nickname", async () => {
    expect(await editNicknames("y", { add: ["MA", "Yummah"] })).toEqual({ nicknames: ["ma"], dead: [] });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("refuses what it cannot keep instead of dropping it: too short, too long, over the cap", async () => {
    await expect(editNicknames("y", { add: ["m"] })).rejects.toThrow(/"m"/);
    h.people = [{ id: "y", name: "Yummah", metadata: { nicknames: Array.from({ length: 12 }, (_, i) => `nick${i}`) } }];
    await expect(editNicknames("y", { add: ["mom"] })).rejects.toThrow(/"mom"/);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("says which nicknames link nobody: shared, or someone's name", async () => {
    h.people.push({ id: "o", name: "Olivia", metadata: { nicknames: ["mom"] } }, { id: "s", name: "Sam", metadata: null });
    const r = await editNicknames("y", { add: ["mom", "sam", "boss"] });
    expect(r.nicknames).toEqual(["ma", "mom", "sam", "boss"]);
    expect(r.dead).toEqual(["mom", "sam"]);
  });
});
