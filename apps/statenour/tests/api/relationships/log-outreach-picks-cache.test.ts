/**
 * Logging outreach for one pick must not throw away the other picks
 * (audit 02-F4a, 2026-10-10).
 *
 * The route deleted the whole cached picks row on every outreach, so the next
 * /people visit paid for a fresh AI re-rank to drop one name. Now it removes
 * only that person from the cached list and deletes the row only when no pick
 * is left.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  recordInteraction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findFirst: h.findFirst, update: h.update, deleteMany: h.deleteMany, create: h.create } },
}));
vi.mock("@/lib/services/people/record-interaction", () => ({
  PersonNotFoundError: class extends Error {},
  recordInteraction: h.recordInteraction,
}));

import { POST } from "@/app/api/relationships/log-outreach/route";

const PICKS = [
  { personId: "p1", personName: "Ann", rationale: "60d silent" },
  { personId: "p2", personName: "Bo", rationale: "birthday in 3d" },
  { personId: "p3", personName: "Cy", rationale: "open promise" },
];

const post = (personId: string) =>
  POST(
    new NextRequest("https://x.test/api/relationships/log-outreach", {
      method: "POST",
      body: JSON.stringify({ personId, message: "hey, coffee this week?" }),
    }),
  );

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.recordInteraction.mockResolvedValue({ ledgerId: "l1", personName: "Ann" });
  h.create.mockResolvedValue({ id: "m1" });
  h.update.mockResolvedValue({});
  h.deleteMany.mockResolvedValue({ count: 1 });
  h.findFirst.mockResolvedValue({ id: "picks_row", metadata: { picks: PICKS, candidateCount: 9 } });
});

describe("log-outreach keeps the rest of today's picks", () => {
  it("removes only the logged person from the cached picks; no delete, no re-rank", async () => {
    const res = await post("p1");
    expect(res.status).toBe(200);
    expect(h.deleteMany).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledTimes(1);
    const arg = h.update.mock.calls[0][0] as { where: { id: string }; data: { metadata: { picks: unknown[]; candidateCount: number } } };
    expect(arg.where).toEqual({ id: "picks_row" });
    expect(arg.data.metadata.picks).toEqual([PICKS[1], PICKS[2]]);
    expect(arg.data.metadata.candidateCount).toBe(9);
  });

  it("people W2b: an evening outreach in New York edits TODAY's ET picks row, not tomorrow's UTC one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T01:30:00Z")); // Oct 30, 21:30 ET
    try {
      await post("p1");
    } finally {
      vi.useRealTimers();
    }
    expect((h.findFirst.mock.calls[0][0] as { where: { key: string } }).where.key).toBe("2026-10-30");
  });

  it("the last pick logged deletes the row", async () => {
    h.findFirst.mockResolvedValue({ id: "picks_row", metadata: { picks: [PICKS[0]] } });
    await post("p1");
    expect(h.update).not.toHaveBeenCalled();
    expect(h.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: a person not in today's picks leaves the cache untouched", async () => {
    await post("someone_else");
    expect(h.update).not.toHaveBeenCalled();
    expect(h.deleteMany).not.toHaveBeenCalled();
  });

  it("a failed cache read never fails the outreach log", async () => {
    h.findFirst.mockRejectedValue(new Error("db down"));
    const res = await post("p1");
    expect(res.status).toBe(200);
  });
});
