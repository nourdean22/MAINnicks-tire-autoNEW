/**
 * tests/api/mission-retro.test.ts · missions-mediums wave · 2026-07-16.
 *
 * Locks the /api/missions/[id]/retro contract fixed in this wave:
 *
 *   1. Archive close is SCOPED: only live ({deletedAt: null}) rows in a
 *      genuinely-open status (INBOX/READY/DOING/WAITING) flip to DONE —
 *      ARCHIVED (an intentionally broken promise) and soft-deleted
 *      tombstones must NOT be DONE-washed.
 *   2. Task-close + mission-COMPLETE land in ONE prisma.$transaction.
 *   3. The retro write is an UPSERT on the (category, key) unique —
 *      a second retro for the same mission used to P2002 forever.
 *
 * Mocks prisma + auth-guard · no real DB. Harness style copied from
 * tests/lib/services/task-actions-cascade.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mission: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  task: {
    groupBy: vi.fn(),
    updateMany: vi.fn(),
  },
  brainMemory: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: mocks.mission,
    task: mocks.task,
    brainMemory: mocks.brainMemory,
    $transaction: mocks.$transaction,
  },
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSession: vi.fn(async () => ({ id: "operator-1" })),
  requireCronAuth: vi.fn(),
  requireSyncAuth: vi.fn(),
}));

import { POST } from "@/app/api/missions/[id]/retro/route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/missions/m1/retro", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: "m1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mission.findUnique.mockResolvedValue({
    id: "m1",
    title: "Mission One",
    status: "ACTIVE",
  });
  mocks.task.groupBy.mockResolvedValue([
    { status: "DONE", _count: { _all: 3 } },
    { status: "READY", _count: { _all: 2 } },
  ]);
  mocks.brainMemory.upsert.mockResolvedValue({ id: "bm1" });
  mocks.task.updateMany.mockResolvedValue({ count: 2 });
  mocks.mission.update.mockResolvedValue({ id: "m1", status: "COMPLETE" });
  // Array-form transaction: ops are already-started promises.
  mocks.$transaction.mockImplementation(async (ops: Promise<unknown>[]) =>
    Promise.all(ops),
  );
});

describe("POST /api/missions/[id]/retro · archive scoping + transaction", () => {
  it("closes only live, genuinely-open tasks inside one transaction", async () => {
    const res = await POST(makeRequest({ retroText: "went well", archive: true }), ctx);
    expect(res.status).toBe(200);

    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.task.updateMany).toHaveBeenCalledTimes(1);
    const args = mocks.task.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      missionId: "m1",
      deletedAt: null,
      status: { in: ["INBOX", "READY", "DOING", "WAITING"] },
    });
    expect(args.data.status).toBe("DONE");

    expect(mocks.mission.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "COMPLETE" },
    });
  });

  it("does not touch tasks or mission when archive=false", async () => {
    const res = await POST(makeRequest({ retroText: "notes", archive: false }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.task.updateMany).not.toHaveBeenCalled();
    expect(mocks.mission.update).not.toHaveBeenCalled();
  });

  it("returns 500 archive_failed when the transaction throws", async () => {
    mocks.$transaction.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(makeRequest({ retroText: "x", archive: true }), ctx);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("archive_failed");
  });
});

describe("POST /api/missions/[id]/retro · retro upsert", () => {
  it("upserts on the (category, key) unique so a second retro saves", async () => {
    const res = await POST(makeRequest({ retroText: "second retro", archive: false }), ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; retroId?: string };
    expect(json.ok).toBe(true);
    expect(json.retroId).toBe("bm1");

    expect(mocks.brainMemory.upsert).toHaveBeenCalledTimes(1);
    const args = mocks.brainMemory.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      category_key: { category: "mission_retro", key: "m1" },
    });
    expect(args.create.content).toContain("second retro");
    expect(args.update.content).toContain("second retro");
    // create carries the row-identity fields the update must not need
    expect(args.create.category).toBe("mission_retro");
    expect(args.create.key).toBe("m1");
  });

  it("skips the brain write entirely when retroText is empty", async () => {
    const res = await POST(makeRequest({ retroText: "", archive: false }), ctx);
    expect(res.status).toBe(200);
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });
});
