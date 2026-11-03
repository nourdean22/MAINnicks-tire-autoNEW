/**
 * W7 silent-failure read, P2 #4 · weekly-review journal rows (entryType "weekly_review") are his words grounded by
 * his own choice. The journal brain must never re-ground or retype them: the dangling-link sweep used to clear
 * enrichedAt on a review row whose goal was later deleted, and the next enrichment re-grounded it by AI from its
 * text and overwrote entryType. That is the only path from review text to a model-chosen goal link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const t = () => ({ findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() });
  return {
    prisma: { brainDump: t(), reflection: t(), situationLog: t(), decisionReplay: t(), lifeGoal: t(), mission: t(), task: t() },
    aiChat: vi.fn(),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/journal/settings", () => ({
  getJournalSettings: vi.fn(async () => ({ creativeIntensity: "off", challengeCadence: "off", autoConfirmThreshold: 0.8 })),
}));
vi.mock("@/lib/brain/memory-admission", () => ({ admitMemory: vi.fn() }));

import { requeueDanglingLinks, writeGrounding } from "@/lib/brain/journal-brain";
import { REVIEW_ENTRY_TYPE } from "@/lib/brain/journal-review-marker";

const NOT_REVIEW = { OR: [{ entryType: null }, { entryType: { not: REVIEW_ENTRY_TYPE } }] };

beforeEach(() => {
  vi.clearAllMocks();
  for (const table of Object.values(h.prisma)) {
    table.findMany.mockResolvedValue([]);
    table.updateMany.mockResolvedValue({ count: 0 });
    table.update.mockResolvedValue({});
  }
});

describe("requeueDanglingLinks · review rows", () => {
  it("the re-grounding requeue excludes review rows, keeping NULL-type rows (no bare NOT)", async () => {
    h.prisma.brainDump.updateMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 1 });
    expect(await requeueDanglingLinks("brain_dump")).toBe(4);
    const [requeue, review] = h.prisma.brainDump.updateMany.mock.calls.map((c) => c[0]);
    expect(requeue.where.AND).toContainEqual(NOT_REVIEW);
    expect(requeue.data).toEqual({ linkStatus: null, linkConfidence: null, enrichedAt: null });
    // CANARY: a review row whose goal was deleted becomes ungrounded and keeps its type and enrichedAt (no AI pass).
    expect(review.where).toMatchObject({ entryType: REVIEW_ENTRY_TYPE, linkStatus: { in: ["auto", "proposed", "confirmed"] } });
    expect(review.where.OR).toEqual(requeue.where.OR);
    expect(review.data).toEqual({ linkStatus: null, linkConfidence: null });
  });

  it("other silos are unchanged (one write, no review clause)", async () => {
    await requeueDanglingLinks("reflection");
    expect(h.prisma.reflection.updateMany).toHaveBeenCalledTimes(1);
    expect(h.prisma.reflection.updateMany.mock.calls[0][0].where.AND).toBeUndefined();
  });
});

describe("writeGrounding · review rows", () => {
  const g = { entryType: "insight", domains: [], goalId: "g1", missionId: null, confidence: 0.95 } as never;

  it("never retypes or re-grounds a review row, and reports it did not write", async () => {
    h.prisma.brainDump.updateMany.mockResolvedValue({ count: 0 });
    expect(await writeGrounding("brain_dump", "d1", g, "auto")).toBe(false);
    expect(h.prisma.brainDump.updateMany.mock.calls[0][0].where).toEqual({ id: "d1", ...NOT_REVIEW });
    expect(h.prisma.brainDump.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { enrichedAt: expect.any(Date) } });
    expect(h.prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("an ordinary entry is grounded as before", async () => {
    h.prisma.brainDump.updateMany.mockResolvedValue({ count: 1 });
    expect(await writeGrounding("brain_dump", "d1", g, "proposed")).toBe(true);
    expect(h.prisma.brainDump.updateMany.mock.calls[0][0].data).toMatchObject({ goalId: "g1", entryType: "insight" });
  });
});
