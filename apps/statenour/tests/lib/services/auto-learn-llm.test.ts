import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  createStructuredAiResponse: vi.fn(),
  storeMemoryEmbedding: vi.fn().mockResolvedValue(undefined),
  getActiveProviderInfo: vi.fn(() => ({ provider: "venice", modelId: "test-model" })),
  today: vi.fn(() => "2026-06-11"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
  },
}));

vi.mock("@/lib/ai/structured", () => ({
  createStructuredAiResponse: mocks.createStructuredAiResponse,
}));

vi.mock("@/lib/ai/provider", () => ({
  getActiveProviderInfo: mocks.getActiveProviderInfo,
}));

vi.mock("@/lib/brain/embedding-utils", () => ({
  storeMemoryEmbedding: mocks.storeMemoryEmbedding,
}));

vi.mock("@/lib/utils/datetime", () => ({ today: mocks.today }));

import { enrichInsightAsync } from "@/lib/services/auto-learn-llm";

describe("enrichInsightAsync · LLM classifier outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Bypass dedup check by returning null (not recently marked)
    mocks.brainMemory.findUnique.mockResolvedValue(null);
    // Return budget allowed (mock upsert/update response)
    mocks.brainMemory.upsert.mockResolvedValue({});
    
    // Default mock LLM response
    mocks.createStructuredAiResponse.mockResolvedValue({
      axis: "velocity",
      lesson: "keep tasks scoped and clear",
      wisdom_query: "reusable lesson text",
      confidence: 0.85,
    });
  });

  it("saves taskOutcome with score and note into metadata when present", async () => {
    await enrichInsightAsync({
      brainMemoryKey: "task_insight:t1",
      brainMemoryId: "row-1",
      task: {
        taskTitle: "learned postgres indexing",
        finishCondition: "done",
        missionTitle: "Engineering",
        missionDomain: "BUSINESS",
        outcomeScore: 85,
        completionNote: "Completed successfully with good results",
      },
    });

    // 1. Verify LLM received prompt with outcome score and completion note
    expect(mocks.createStructuredAiResponse).toHaveBeenCalledTimes(1);
    const aiArgs = mocks.createStructuredAiResponse.mock.calls[0][0];
    expect(aiArgs.userPrompt).toContain("Outcome score: 85");
    expect(aiArgs.userPrompt).toContain("Completion note: Completed successfully with good results");

    // 2. Verify database update contains the correctly shaped taskOutcome metadata
    expect(mocks.brainMemory.update).toHaveBeenCalledTimes(1);
    const updateArgs = mocks.brainMemory.update.mock.calls[0][0];
    expect(updateArgs.where.category_key).toEqual({
      category: "task_insight",
      key: "task_insight:t1",
    });
    expect(updateArgs.data.metadata).toMatchObject({
      axis: "velocity",
      lesson: "keep tasks scoped and clear",
      taskOutcome: {
        score: 85,
        note: "Completed successfully with good results",
      },
    });
  });

  it("saves taskOutcome with nulls when outcome fields are missing", async () => {
    await enrichInsightAsync({
      brainMemoryKey: "task_insight:t2",
      brainMemoryId: "row-2",
      task: {
        taskTitle: "studied machine learning",
        finishCondition: null,
        missionTitle: null,
        missionDomain: null,
      },
    });

    // 1. Verify LLM prompt contains (none) fallbacks
    expect(mocks.createStructuredAiResponse).toHaveBeenCalledTimes(1);
    const aiArgs = mocks.createStructuredAiResponse.mock.calls[0][0];
    expect(aiArgs.userPrompt).toContain("Outcome score: (none)");
    expect(aiArgs.userPrompt).toContain("Completion note: (none)");

    // 2. Verify database update has nulls inside taskOutcome
    expect(mocks.brainMemory.update).toHaveBeenCalledTimes(1);
    const updateArgs = mocks.brainMemory.update.mock.calls[0][0];
    expect(updateArgs.data.metadata).toMatchObject({
      taskOutcome: {
        score: null,
        note: null,
      },
    });
  });

  it("limits completion note length to 1000 characters before metadata storage", async () => {
    const longNote = "a".repeat(1200);
    await enrichInsightAsync({
      brainMemoryKey: "task_insight:t3",
      brainMemoryId: "row-3",
      task: {
        taskTitle: "finished a complex task",
        finishCondition: null,
        missionTitle: null,
        missionDomain: null,
        outcomeScore: 90,
        completionNote: longNote,
      },
    });

    expect(mocks.brainMemory.update).toHaveBeenCalledTimes(1);
    const updateArgs = mocks.brainMemory.update.mock.calls[0][0];
    expect(updateArgs.data.metadata.taskOutcome.note.length).toBe(1000);
    expect(updateArgs.data.metadata.taskOutcome.note).toBe("a".repeat(1000));
  });
});
