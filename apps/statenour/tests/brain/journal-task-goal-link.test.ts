/**
 * A journal entry's tasks follow its goal link (job 2026-10-30-goals-system W3b).
 *
 * journal-ingest creates Inbox tasks from an entry's action items BEFORE the async grounding
 * pass links the entry to a goal, so those tasks never got a goalId. Ingest records the ids
 * it made in extractedItems.createdTaskIds; a trusted link (auto / confirmed) gives exactly
 * those tasks the goal, only where goalId is still empty, and a rejected link takes back
 * only what it gave.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const t = () => ({ findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() });
  return { prisma: { task: t(), brainDump: t(), reflection: t(), situationLog: t(), decisionReplay: t(), lifeGoal: t(), mission: t() } };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => vi.fn() }));
vi.mock("@/lib/journal/settings", () => ({
  getJournalSettings: vi.fn(async () => ({ creativeIntensity: "off", challengeCadence: "off", autoConfirmThreshold: 0.8 })),
}));
vi.mock("@/lib/brain/memory-admission", () => ({ admitMemory: vi.fn() }));

import { createdTaskIdsOf, linkJournalTasksToGoal, unlinkJournalTasksFromGoal, withCreatedTaskIds } from "@/lib/brain/journal-task-link";
import { confirmJournalLink, writeGrounding } from "@/lib/brain/journal-brain";

const DUMP = "cmvsb0hcf02h1o201zmv9jxek";

beforeEach(() => {
  vi.clearAllMocks();
  h.prisma.task.updateMany.mockResolvedValue({ count: 2 });
  h.prisma.brainDump.findUnique.mockResolvedValue({ extractedItems: JSON.stringify({ actionItems: [], createdTaskIds: ["t1", "t2"] }), goalId: "g1", missionId: null });
  h.prisma.brainDump.update.mockResolvedValue({});
  h.prisma.lifeGoal.findUnique.mockResolvedValue(null);
});

describe("createdTaskIds in extractedItems", () => {
  it("adds the ids without dropping what the journal already stored, and reads them back", () => {
    const json = withCreatedTaskIds(JSON.stringify({ entryType: "planning", actionItems: [{ title: "x" }] }), ["t1"]);
    expect(JSON.parse(json)).toEqual({ entryType: "planning", actionItems: [{ title: "x" }], createdTaskIds: ["t1"] });
    expect(createdTaskIdsOf(json)).toEqual(["t1"]);
  });

  it("an unreadable blob is left untouched and reads as no ids", () => {
    expect(withCreatedTaskIds("{bad", ["t1"])).toBe("{bad");
    expect(createdTaskIdsOf("{bad")).toEqual([]);
    expect(createdTaskIdsOf(null)).toEqual([]);
  });
});

describe("linkJournalTasksToGoal", () => {
  it("fills goalId on exactly the entry's own unlinked live tasks, in one atomic update", async () => {
    expect(await linkJournalTasksToGoal(DUMP, "g1")).toBe(2);
    expect(h.prisma.task.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1", "t2"] }, goalId: null, deletedAt: null },
      data: { goalId: "g1" },
    });
  });

  it("an entry that made no tasks touches nothing", async () => {
    h.prisma.brainDump.findUnique.mockResolvedValueOnce({ extractedItems: JSON.stringify({ actionItems: [] }) });
    expect(await linkJournalTasksToGoal(DUMP, "g1")).toBe(0);
    expect(h.prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("a failed write reports 0 and never throws into the grounding pass", async () => {
    h.prisma.task.updateMany.mockRejectedValueOnce(new Error("neon down"));
    expect(await linkJournalTasksToGoal(DUMP, "g1")).toBe(0);
  });

  it("unlink takes back only tasks pointing at that goal", async () => {
    await unlinkJournalTasksFromGoal(DUMP, "g1");
    expect(h.prisma.task.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["t1", "t2"] }, goalId: "g1" }, data: { goalId: null } });
  });
});

describe("confirmJournalLink · the entry's tasks follow the decision", () => {
  it("accept on a brain dump links its tasks to the goal", async () => {
    await confirmJournalLink("brain_dump", DUMP, true);
    expect(h.prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { goalId: "g1" } }));
  });

  it("reject on a brain dump takes the link back from its tasks", async () => {
    await confirmJournalLink("brain_dump", DUMP, false);
    expect(h.prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { goalId: null } }));
  });

  it("other silos create no tasks, so nothing is touched", async () => {
    h.prisma.reflection.findUnique.mockResolvedValue({ goalId: "g1", missionId: null });
    await confirmJournalLink("reflection", "r1", true);
    expect(h.prisma.task.updateMany).not.toHaveBeenCalled();
  });
});

describe("writeGrounding · only a trusted goal link moves tasks", () => {
  const g = (goalId: string | null) => ({ entryType: "planning", domains: [], goalId, missionId: null, confidence: 0.9 });

  it("an auto link on a brain dump links its tasks", async () => {
    await writeGrounding("brain_dump", DUMP, g("g1") as never, "auto");
    expect(h.prisma.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { goalId: "g1" } }));
  });

  it("a proposed link waits for Nour's tap; no goal, or another silo, touches nothing", async () => {
    await writeGrounding("brain_dump", DUMP, g("g1") as never, "proposed");
    await writeGrounding("brain_dump", DUMP, g(null) as never, null);
    h.prisma.reflection.update.mockResolvedValue({});
    await writeGrounding("reflection", "r1", g("g1") as never, "auto");
    expect(h.prisma.task.updateMany).not.toHaveBeenCalled();
  });
});
