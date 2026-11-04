/**
 * W8b (audit B2) · the grounding call enrichJournalEntry already makes on every reflection also returns the people
 * the entry names, and a REFLECTION then runs the journal people link (merge: the ids the composer's exact-name
 * pass already stamped survive). brain_dumps are linked by ingestJournal and are NOT linked again here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  aiChat: vi.fn(),
  link: vi.fn(),
  reflUpdateMany: vi.fn(),
  reflUpdate: vi.fn(),
  reflFindUnique: vi.fn(),
  dumpUpdateMany: vi.fn(),
  recordError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: vi.fn(async () => []) },
    mission: { findMany: vi.fn(async () => []) },
    reflection: { updateMany: h.reflUpdateMany, update: h.reflUpdate, findUnique: h.reflFindUnique },
    brainDump: { updateMany: h.dumpUpdateMany, update: vi.fn(async () => ({})) },
    brainMemory: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "m" })) },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: h.recordError }));
vi.mock("@/lib/journal/settings", () => ({
  getJournalSettings: vi.fn(async () => ({ autoConfirmThreshold: 0.8, creativeIntensity: "off", challengeCadence: "off" })),
}));
vi.mock("@/lib/brain/journal-task-link", () => ({ linkJournalTasksToGoal: vi.fn(), unlinkJournalTasksFromGoal: vi.fn() }));
vi.mock("@/lib/brain/memory-admission", () => ({ admitMemory: vi.fn(async () => ({ admitted: false })) }));
vi.mock("@/lib/mastery/credit", () => ({ creditStatXp: vi.fn() }));
vi.mock("@/lib/mastery/goal-stats", () => ({ effectiveGoalStats: vi.fn(async () => []) }));
vi.mock("@/lib/services/people/journal-link", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/people/journal-link")>()),
  linkJournalPeople: h.link,
}));

import { enrichJournalEntry } from "@/lib/brain/journal-brain";

const createdAt = new Date("2026-11-03T14:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  h.reflUpdateMany.mockResolvedValue({ count: 1 });
  h.dumpUpdateMany.mockResolvedValue({ count: 1 });
  h.reflUpdate.mockResolvedValue({});
  h.reflFindUnique.mockResolvedValue({ createdAt });
  h.link.mockResolvedValue({ personIds: ["p1"], recorded: 1, skipped: 0, failed: 0, rejected: 0, linkedNames: ["Dania"], rejectedNames: [] });
  h.aiChat.mockResolvedValue({
    content: JSON.stringify({ entryType: "reflection", domains: [], goalId: null, missionId: null, confidence: 0, people: [{ name: "Dania", interacted: true }] }),
    provider: "ollama",
  });
});

describe("enrichJournalEntry · people on a reflection", () => {
  it("the prompt asks for people; a reflection links them with merge and its own createdAt", async () => {
    await enrichJournalEntry("reflection", "r1", "Talked to Dania about the move tonight.");
    const system = (h.aiChat.mock.calls[0][0] as Array<{ role: string; content: string }>).find((m) => m.role === "system")!.content;
    expect(system).toMatch(/"people"/);
    expect(system).toMatch(/interacted/);
    expect(h.link).toHaveBeenCalledTimes(1);
    expect(h.link).toHaveBeenCalledWith({
      silo: "reflection",
      merge: true,
      dumpId: "r1",
      createdAt,
      rawText: "Talked to Dania about the move tonight.",
      people: [{ name: "Dania", interacted: true }],
    });
  });

  it("a brain_dump is not linked here (ingestJournal owns that)", async () => {
    await enrichJournalEntry("brain_dump", "d1", "Talked to Dania about the move tonight.");
    expect(h.link).not.toHaveBeenCalled();
  });

  it("a model answer with no people list links nothing and does not throw", async () => {
    h.aiChat.mockResolvedValue({ content: JSON.stringify({ entryType: "reflection", goalId: null, missionId: null, confidence: 0 }), provider: "ollama" });
    await enrichJournalEntry("reflection", "r1", "Nothing about anyone in particular here.");
    expect(h.link).not.toHaveBeenCalled();
  });

  it("a failed link is logged, never thrown out of the enrich", async () => {
    h.link.mockRejectedValue(new Error("boom"));
    await expect(enrichJournalEntry("reflection", "r1", "Talked to Dania about the move tonight.")).resolves.toBeUndefined();
    expect(h.recordError).toHaveBeenCalledWith("brain:journal-ingest", expect.any(Error), expect.objectContaining({ phase: "reflection-people-link", reflectionId: "r1" }));
  });
});
