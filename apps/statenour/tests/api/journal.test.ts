import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "@/lib/trpc/root";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    brainMemory: {
      findMany: vi.fn(),
    },
    brainDump: {
      findMany: vi.fn(),
    },
    reflection: {
      findMany: vi.fn(),
    },
    situationLog: {
      findMany: vi.fn(),
    },
    decisionReplay: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

describe("tRPC journal.insightsPreview", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = appRouter.createCaller({
      session: {
        id: "operator-1",
        email: "operator@statenour.local",
        role: "operator",
      },
      db: mockPrisma as any,
    });
  });

  it("returns empty array immediately when no brainMemory takeaways exist", async () => {
    mockPrisma.brainMemory.findMany.mockResolvedValue([]);

    const result = await caller.journal.insightsPreview();

    expect(result).toEqual([]);
    expect(mockPrisma.brainMemory.findMany).toHaveBeenCalled();
    // Verify it doesn't query other tables if no takeaways are found
    expect(mockPrisma.brainDump.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.reflection.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.situationLog.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.decisionReplay.findMany).not.toHaveBeenCalled();
  });

  it("parses valid JSON fields and maps to nextAction, idea, and challenge", async () => {
    const mockTakeDate = new Date("2026-06-14T12:00:00Z");
    mockPrisma.brainMemory.findMany.mockResolvedValue([
      {
        id: "take-1",
        key: "journal-take:entry-1",
        content: JSON.stringify({
          idea: "Try refactoring layout components",
          challenge: "Visual hierarchy is hard to maintain",
          nextAction: { action: "Extract Card component", domain: "mastery" },
        }),
        category: "journal_brain_take",
        updatedAt: mockTakeDate,
        createdAt: mockTakeDate,
        deletedAt: null,
      },
    ]);

    // Mock parent queries returning empty so it falls back to default title
    mockPrisma.brainDump.findMany.mockResolvedValue([]);
    mockPrisma.reflection.findMany.mockResolvedValue([]);
    mockPrisma.situationLog.findMany.mockResolvedValue([]);
    mockPrisma.decisionReplay.findMany.mockResolvedValue([]);

    const result = await caller.journal.insightsPreview();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "take-1",
      entryId: "entry-1",
      updatedAt: mockTakeDate,
      idea: "Try refactoring layout components",
      challenge: "Visual hierarchy is hard to maintain",
      nextAction: { action: "Extract Card component", domain: "mastery" },
      entryTitle: "Journal Entry",
      goalId: null,
      // Loop-closure wave · server-truth promoted flags (false when unset)
      ideaPromoted: false,
      challengePromoted: false,
      nextActionPromoted: false,
    });
  });

  it("scrubs literal 'null'-string next actions (legacy model artifact)", async () => {
    const mockTakeDate = new Date("2026-06-14T12:00:00Z");
    mockPrisma.brainMemory.findMany.mockResolvedValue([
      {
        id: "take-null",
        key: "journal-take:entry-null",
        content: JSON.stringify({
          idea: "still a real idea",
          challenge: null,
          nextAction: { action: "null", domain: null },
        }),
        updatedAt: mockTakeDate,
      },
    ]);
    mockPrisma.brainDump.findMany.mockResolvedValue([]);
    mockPrisma.reflection.findMany.mockResolvedValue([]);
    mockPrisma.situationLog.findMany.mockResolvedValue([]);
    mockPrisma.decisionReplay.findMany.mockResolvedValue([]);

    const result = await caller.journal.insightsPreview();

    expect(result).toHaveLength(1);
    expect(result[0].nextAction).toBeNull();
    expect(result[0].idea).toBe("still a real idea");
  });

  it("recovers gracefully and returns null fields when JSON is malformed", async () => {
    const mockTakeDate = new Date("2026-06-14T12:00:00Z");
    mockPrisma.brainMemory.findMany.mockResolvedValue([
      {
        id: "take-2",
        key: "journal-take:entry-2",
        content: "{invalid-json}",
        category: "journal_brain_take",
        updatedAt: mockTakeDate,
        createdAt: mockTakeDate,
        deletedAt: null,
      },
    ]);

    mockPrisma.brainDump.findMany.mockResolvedValue([]);
    mockPrisma.reflection.findMany.mockResolvedValue([]);
    mockPrisma.situationLog.findMany.mockResolvedValue([]);
    mockPrisma.decisionReplay.findMany.mockResolvedValue([]);

    const result = await caller.journal.insightsPreview();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "take-2",
      entryId: "entry-2",
      updatedAt: mockTakeDate,
      idea: null,
      challenge: null,
      nextAction: null,
      entryTitle: "Journal Entry",
      goalId: null,
      ideaPromoted: false,
      challengePromoted: false,
      nextActionPromoted: false,
    });
  });

  it("correctly maps entryTitle and goalId for all four parent types", async () => {
    const mockTakeDate = new Date("2026-06-14T12:00:00Z");
    
    // We mock 5 takes pointing to:
    // 1. brainDump (matching summary)
    // 2. brainDump (matching rawThoughts since summary is missing)
    // 3. reflection
    // 4. situationLog
    // 5. decisionReplay
    mockPrisma.brainMemory.findMany.mockResolvedValue([
      {
        id: "take-1",
        key: "journal-take:dump-summary-id",
        content: JSON.stringify({ idea: "Idea 1" }),
        category: "journal_brain_take",
        updatedAt: mockTakeDate,
        createdAt: mockTakeDate,
        deletedAt: null,
      },
      {
        id: "take-2",
        key: "journal-take:dump-raw-id",
        content: JSON.stringify({ idea: "Idea 2" }),
        category: "journal_brain_take",
        updatedAt: mockTakeDate,
        createdAt: mockTakeDate,
        deletedAt: null,
      },
      {
        id: "take-3",
        key: "journal-take:reflect-id",
        content: JSON.stringify({ idea: "Idea 3" }),
        category: "journal_brain_take",
        updatedAt: mockTakeDate,
        createdAt: mockTakeDate,
        deletedAt: null,
      },
      {
        id: "take-4",
        key: "journal-take:situation-id",
        content: JSON.stringify({ idea: "Idea 4" }),
        category: "journal_brain_take",
        updatedAt: mockTakeDate,
        createdAt: mockTakeDate,
        deletedAt: null,
      },
      {
        id: "take-5",
        key: "journal-take:decision-id",
        content: JSON.stringify({ idea: "Idea 5" }),
        category: "journal_brain_take",
        updatedAt: mockTakeDate,
        createdAt: mockTakeDate,
        deletedAt: null,
      },
    ]);

    // Mock parent records
    mockPrisma.brainDump.findMany.mockResolvedValue([
      {
        id: "dump-summary-id",
        summary: "This is a brief summary of my brain dump that should be sliced if too long",
        rawThoughts: "Ignored raw thoughts",
        goalId: "goal-1",
      },
      {
        id: "dump-raw-id",
        summary: null,
        rawThoughts: "Raw thoughts fallback that is also sliced if it exceeds the limit",
        goalId: "goal-2",
      },
    ]);

    mockPrisma.reflection.findMany.mockResolvedValue([
      {
        id: "reflect-id",
        insight: "Reflection insight description to map to entryTitle",
        goalId: "goal-3",
      },
    ]);

    mockPrisma.situationLog.findMany.mockResolvedValue([
      {
        id: "situation-id",
        situation: "Current complex situation log details",
        goalId: "goal-4",
      },
    ]);

    mockPrisma.decisionReplay.findMany.mockResolvedValue([
      {
        id: "decision-id",
        title: "Decision to switch B2B supplier",
        goalId: "goal-5",
      },
    ]);

    const result = await caller.journal.insightsPreview();

    expect(result).toHaveLength(5);

    // 1. BrainDump summary map
    const res1 = result.find((r) => r.id === "take-1");
    expect(res1?.entryTitle).toBe("This is a brief summary of my brain dump that should be sliced if too long");
    expect(res1?.goalId).toBe("goal-1");

    // 2. BrainDump rawThoughts map
    const res2 = result.find((r) => r.id === "take-2");
    expect(res2?.entryTitle).toBe("Raw thoughts fallback that is also sliced if it exceeds the limit");
    expect(res2?.goalId).toBe("goal-2");

    // 3. Reflection map
    const res3 = result.find((r) => r.id === "take-3");
    expect(res3?.entryTitle).toBe("Reflection insight description to map to entryTitle");
    expect(res3?.goalId).toBe("goal-3");

    // 4. SituationLog map
    const res4 = result.find((r) => r.id === "take-4");
    expect(res4?.entryTitle).toBe("Current complex situation log details");
    expect(res4?.goalId).toBe("goal-4");

    // 5. DecisionReplay map
    const res5 = result.find((r) => r.id === "take-5");
    expect(res5?.entryTitle).toBe("Decision to switch B2B supplier");
    expect(res5?.goalId).toBe("goal-5");
  });

  it("enforces title limits by slicing long titles from parent records", async () => {
    mockPrisma.brainMemory.findMany.mockResolvedValue([
      {
        id: "take-1",
        key: "journal-take:long-id",
        content: "{}",
        category: "journal_brain_take",
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);

    // Mock a reflection with a very long insight (>120 chars)
    const longInsight = "A".repeat(150);
    mockPrisma.reflection.findMany.mockResolvedValue([
      {
        id: "long-id",
        insight: longInsight,
        goalId: "goal-1",
      },
    ]);
    mockPrisma.brainDump.findMany.mockResolvedValue([]);
    mockPrisma.situationLog.findMany.mockResolvedValue([]);
    mockPrisma.decisionReplay.findMany.mockResolvedValue([]);

    const result = await caller.journal.insightsPreview();

    expect(result).toHaveLength(1);
    expect(result[0].entryTitle).toHaveLength(120);
    expect(result[0].entryTitle).toBe("A".repeat(120));
  });
});
