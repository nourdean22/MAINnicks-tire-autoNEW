/**
 * getMemoryDetail · 2026-09-15.
 *
 * Prisma is mocked (the repo pattern, tests/services/cost-slo.test.ts). The
 * load-bearing assertion is the soft-delete filter: 35% of brain_memories
 * rows are soft-deleted, and a by-id read that skipped `deletedAt: null`
 * would resurrect a deleted memory as a live fact in the inspector. Mutation
 * receipt: with `activeOnly` removed from the service the first test fails
 * on `deletedAt` (run 2026-09-15 before commit).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: mocks.brainMemory },
}));

import { getMemoryDetail } from "@/lib/services/brain/memory-detail";

const ROW = {
  id: "m1",
  category: "preference",
  key: "prefers-evening-workouts",
  content: "Nour prefers evening workouts at Titans",
  source: "tool-exec receipt",
  trustTier: "OPERATOR",
  confidence: 0.8,
  seenCount: 4,
  createdBy: "user",
  createdAt: new Date("2026-08-01T10:00:00Z"),
  updatedAt: new Date("2026-09-01T10:00:00Z"),
  lastSeen: new Date("2026-09-10T10:00:00Z"),
  expiresAt: null,
  validFrom: new Date("2026-08-01T10:00:00Z"),
  validUntil: null,
  lastVerifiedAt: null,
  discoveryVerdict: null,
  supersededBy: null,
  supersedes: [{ id: "m0", content: "x".repeat(400), createdAt: new Date("2026-07-01T10:00:00Z") }],
};

beforeEach(() => {
  mocks.brainMemory.findFirst.mockReset();
});

describe("getMemoryDetail", () => {
  it("reads ONLY live rows: the where clause carries deletedAt: null alongside the id", async () => {
    mocks.brainMemory.findFirst.mockResolvedValue(ROW);
    await getMemoryDetail("m1");
    expect(mocks.brainMemory.findFirst).toHaveBeenCalledTimes(1);
    const args = mocks.brainMemory.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ id: "m1", deletedAt: null });
  });

  it("returns null when nothing is readable (deleted, expired or never existed look the same to the caller)", async () => {
    mocks.brainMemory.findFirst.mockResolvedValue(null);
    expect(await getMemoryDetail("nope")).toBeNull();
  });

  it("maps the row: ISO dates, the ladder class from the source, snippets on the supersession chain", async () => {
    mocks.brainMemory.findFirst.mockResolvedValue(ROW);
    const detail = (await getMemoryDetail("m1"))!;
    expect(detail.evidence).toBe("system_receipt"); // "receipt" in the source → the gateway's class
    expect(detail.createdAt).toBe("2026-08-01T10:00:00.000Z");
    expect(detail.validFrom).toBe("2026-08-01T10:00:00.000Z");
    expect(detail.validUntil).toBeNull();
    expect(detail.supersededBy).toBeNull();
    expect(detail.supersedes).toHaveLength(1);
    expect(detail.supersedes[0]!.content.length).toBeLessThanOrEqual(160);
    expect(detail.supersedes[0]!.content.endsWith("...")).toBe(true);
    expect(detail.trustTier).toBe("OPERATOR");
    expect(detail.seenCount).toBe(4);
  });
});

describe("supersededBy is a to-one relation Prisma cannot filter — the service does", () => {
  it("a soft-deleted successor renders as no successor; a live one links", async () => {
    const successor = { id: "m2", content: "newer", createdAt: new Date("2026-09-05T10:00:00Z") };
    mocks.brainMemory.findFirst.mockResolvedValue({ ...ROW, supersededBy: { ...successor, deletedAt: new Date("2026-09-06T10:00:00Z") } });
    expect((await getMemoryDetail("m1"))!.supersededBy).toBeNull();
    mocks.brainMemory.findFirst.mockResolvedValue({ ...ROW, supersededBy: { ...successor, deletedAt: null } });
    expect((await getMemoryDetail("m1"))!.supersededBy).toEqual({ id: "m2", content: "newer", createdAt: "2026-09-05T10:00:00.000Z" });
  });
});
