/**
 * W8a (audit C4): "remember that this goal depends on X" used to land as a pinned_user row with no goalId or
 * personId, invisible to the /brain goal and person filters. pinMemory takes optional ids, checks them against live
 * rows, and stores them in metadata; an unknown id is dropped and said.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  goalFindFirst: vi.fn(),
  personFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { upsert: h.upsert, findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    lifeGoal: { findFirst: h.goalFindFirst },
    personProfile: { findFirst: h.personFindFirst },
  },
}));
vi.mock("@/lib/brain/embeddings", () => ({ storeMemoryEmbedding: vi.fn(async () => undefined) }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: vi.fn(async () => undefined) }));

import { brainTools } from "@/lib/ai/tools/brain";

type Exec = (a: Record<string, unknown>, o: unknown) => Promise<Record<string, unknown>>;
const pin = (args: Record<string, unknown>) => (brainTools.pinMemory.execute as unknown as Exec)(args, {});

beforeEach(() => {
  h.upsert.mockReset().mockResolvedValue({ id: "bm1" });
  h.goalFindFirst.mockReset().mockResolvedValue(null);
  h.personFindFirst.mockReset().mockResolvedValue(null);
});

describe("pinMemory · goalId / personId", () => {
  it("stores live ids in metadata on create and update, and reports them linked", async () => {
    h.goalFindFirst.mockResolvedValue({ id: "g1" });
    h.personFindFirst.mockResolvedValue({ id: "p1" });
    const r = await pin({ content: "This goal depends on Sam's schedule", goalId: "g1", personId: "p1" });
    expect(h.goalFindFirst.mock.calls[0][0].where).toEqual({ id: "g1", deletedAt: null });
    expect(h.personFindFirst.mock.calls[0][0].where).toEqual({ id: "p1", deletedAt: null });
    const args = h.upsert.mock.calls[0][0];
    expect(args.create.metadata).toEqual({ goalId: "g1", personId: "p1" });
    expect(args.update.metadata).toEqual({ goalId: "g1", personId: "p1" });
    expect(r).toMatchObject({ pinned: true, goalLinked: true, personLinked: true });
  });

  it("an unknown id is dropped and said, never written (the filters would point at nothing)", async () => {
    const r = await pin({ content: "x", goalId: "nope" });
    const args = h.upsert.mock.calls[0][0];
    expect(args.create.metadata).toBeUndefined();
    expect(r).toMatchObject({ pinned: true, goalLinked: false });
    expect(String(r.goalNote)).toMatch(/not found/i);
  });

  it("without ids nothing is looked up and no metadata is written", async () => {
    await pin({ content: "plain fact" });
    expect(h.goalFindFirst).not.toHaveBeenCalled();
    expect(h.personFindFirst).not.toHaveBeenCalled();
    expect(h.upsert.mock.calls[0][0].create.metadata).toBeUndefined();
  });
});
