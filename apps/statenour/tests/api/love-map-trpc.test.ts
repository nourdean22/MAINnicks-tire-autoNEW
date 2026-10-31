/**
 * task.loveMapQuestion and task.answerLoveMap (people W2c, 2026-10-30): the
 * read skips soft-deleted people and keys on the New York day; the answer is
 * appended to the person's notes and never writes over them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "@/lib/trpc/root";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { personProfile: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/brain/people-embed-hook", () => ({ enqueuePersonEmbed: vi.fn() }));

describe("tRPC task love-map", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    caller = appRouter.createCaller({ session: { id: "operator-1", email: "operator@statenour.local", role: "operator" }, db: mockPrisma as never });
  });

  it("reads live people only and keys the question on the New York date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T01:30:00Z")); // 21:30 on Oct 30 in New York
    mockPrisma.personProfile.findMany.mockResolvedValue([{ id: "p1", name: "Sam Rivers", leverageNotes: null }]);
    const q = await caller.task.loveMapQuestion();
    expect(mockPrisma.personProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null } }));
    expect(q).toMatchObject({ personId: "p1", dayKey: "2026-10-30" });
  });

  it("appends the answer under existing notes", async () => {
    mockPrisma.personProfile.findFirst.mockResolvedValue({ leverageNotes: "works nights" });
    const out = await caller.task.answerLoveMap({ personId: "p1", question: "Who matters most to Sam?", answer: "his brother" });
    expect(out).toEqual({ ok: true });
    expect(mockPrisma.personProfile.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { leverageNotes: "works nights\nWho matters most to Sam? his brother" },
    });
  });

  it("writes nothing when the notes would pass the cap, or the person is gone", async () => {
    mockPrisma.personProfile.findFirst.mockResolvedValueOnce({ leverageNotes: "x".repeat(1995) });
    expect(await caller.task.answerLoveMap({ personId: "p1", question: "Q?", answer: "long answer" })).toEqual({ ok: false, reason: "too_long" });
    mockPrisma.personProfile.findFirst.mockResolvedValueOnce(null);
    expect(await caller.task.answerLoveMap({ personId: "p9", question: "Q?", answer: "a" })).toEqual({ ok: false, reason: "not_found" });
    expect(mockPrisma.personProfile.update).not.toHaveBeenCalled();
  });
});
