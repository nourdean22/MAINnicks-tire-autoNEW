import { describe, expect, it, vi, beforeEach } from "vitest";
import { withGuardian, GuardianApprovalPendingError } from "@/lib/tools/guardian";
import { prisma } from "@/lib/prisma";
import { evaluateToolAction } from "@/lib/tools/tool-policy";
import { semanticSearch } from "@/lib/brain/embedding-utils";

const mockApprovalRequestFindFirst = vi.fn();
const mockApprovalRequestCreate = vi.fn();
const mockMemoryInboxItemFindFirst = vi.fn();
const mockMemoryInboxItemCreate = vi.fn();
const mockBrainMemoryFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    approvalRequest: {
      findFirst: () => mockApprovalRequestFindFirst(),
      create: (args: any) => mockApprovalRequestCreate(args),
    },
    memoryInboxItem: {
      findFirst: () => mockMemoryInboxItemFindFirst(),
      create: (args: any) => mockMemoryInboxItemCreate(args),
    },
    brainMemory: {
      findMany: (args: any) => mockBrainMemoryFindMany(args),
    },
  },
}));

const mockEvaluateToolAction = vi.fn();
vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: (args: any) => mockEvaluateToolAction(args),
}));

vi.mock("@/lib/brain/embedding-utils", () => ({
  semanticSearch: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApprovalRequestFindFirst.mockReset();
  mockApprovalRequestCreate.mockReset();
  mockMemoryInboxItemFindFirst.mockReset();
  mockMemoryInboxItemCreate.mockReset();
  mockBrainMemoryFindMany.mockReset();
  mockEvaluateToolAction.mockReset();
  vi.mocked(semanticSearch).mockReset();
});

describe("Safety Pipelines: Tool Approval Queue", () => {
  it("Guarding a tool requiring approval creates ApprovalRequest and throws GuardianApprovalPendingError", async () => {
    mockEvaluateToolAction.mockReturnValue({
      decision: "require_approval",
      riskClass: "high",
      reason: "Requires manual confirmation"
    });

    mockApprovalRequestFindFirst.mockResolvedValue(null);
    mockApprovalRequestCreate.mockResolvedValue({
      id: "req_123"
    });

    const dummyTool = vi.fn().mockResolvedValue("draft_created");
    const guarded = withGuardian("gmail.compose_draft_card", dummyTool);

    await expect(guarded({ body: "hello world" })).rejects.toThrow(GuardianApprovalPendingError);
    expect(mockApprovalRequestCreate).toHaveBeenCalledTimes(1);
    expect(mockApprovalRequestCreate.mock.calls[0][0].data).toMatchObject({
      toolId: "gmail.compose_draft_card",
      actionType: "require_approval",
      status: "pending_approval",
      riskClass: "high",
      payload: { body: "hello world" },
      requestedBy: "agent"
    });
    expect(dummyTool).not.toHaveBeenCalled();
  });
});

describe("Safety Pipelines: Memory Ingestion Inbox", () => {
  it("Guarding memory.pin with containsExternalContent: true (no conflict) creates MemoryInboxItem quarantined and throws GuardianApprovalPendingError", async () => {
    mockEvaluateToolAction.mockReturnValue({
      decision: "require_memory_review",
      riskClass: "medium",
      reason: "Requires memory review due to external content"
    });

    mockMemoryInboxItemFindFirst.mockResolvedValue(null);
    vi.mocked(semanticSearch).mockResolvedValue([]); // no conflict candidates
    mockMemoryInboxItemCreate.mockResolvedValue({
      id: "inbox_q1"
    });

    const dummyTool = vi.fn().mockResolvedValue("pinned");
    const guarded = withGuardian("memory.pin", dummyTool);

    await expect(guarded({ content: "Nour likes green tea", containsExternalContent: true })).rejects.toThrow(GuardianApprovalPendingError);
    expect(mockMemoryInboxItemCreate).toHaveBeenCalledTimes(1);
    expect(mockMemoryInboxItemCreate.mock.calls[0][0].data).toMatchObject({
      sourceType: "agent_tool",
      rawTextFenced: "Nour likes green tea",
      status: "quarantined",
      contradictionLogs: []
    });
    expect(dummyTool).not.toHaveBeenCalled();
  });

  it("Guarding memory.pin with a conflict quarantines the memory with state conflicting and populates contradictionLogs", async () => {
    mockEvaluateToolAction.mockReturnValue({
      decision: "require_memory_review",
      riskClass: "medium",
      reason: "Requires memory review"
    });

    mockMemoryInboxItemFindFirst.mockResolvedValue(null);
    
    // Mock semanticSearch returning a conflict with similarity 0.85
    vi.mocked(semanticSearch).mockResolvedValue([
      { sourceId: "mem_conflicting", similarity: 0.85 }
    ] as any);

    mockBrainMemoryFindMany.mockResolvedValue([
      { id: "mem_conflicting", content: "Nour dislikes green tea", category: "preferences", createdAt: new Date("2026-05-10T10:00:00Z") }
    ]);

    mockMemoryInboxItemCreate.mockResolvedValue({
      id: "inbox_c1"
    });

    const dummyTool = vi.fn().mockResolvedValue("pinned");
    const guarded = withGuardian("memory.pin", dummyTool);

    await expect(guarded({ content: "Nour likes green tea" })).rejects.toThrow(GuardianApprovalPendingError);
    
    expect(mockMemoryInboxItemCreate).toHaveBeenCalledTimes(1);
    expect(mockMemoryInboxItemCreate.mock.calls[0][0].data).toMatchObject({
      sourceType: "agent_tool",
      rawTextFenced: "Nour likes green tea",
      status: "conflicting"
    });
    
    // Verify contradictionLogs are formatted correctly
    const contradictionLogs = mockMemoryInboxItemCreate.mock.calls[0][0].data.contradictionLogs;
    expect(contradictionLogs).toHaveLength(1);
    expect(contradictionLogs[0]).toMatchObject({
      id: "mem_conflicting",
      content: "Nour dislikes green tea",
      similarity: 0.85,
      category: "preferences",
      createdAt: "2026-05-10T10:00:00.000Z"
    });
    expect(dummyTool).not.toHaveBeenCalled();
  });
});
