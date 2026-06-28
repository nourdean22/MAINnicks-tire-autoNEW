import { describe, it, expect, vi } from "vitest";

// Mock the child tools so we can test wrapToolsWithEmptyHandling
const mockGetTasks = vi.fn();
const mockCompleteTask = vi.fn();

vi.mock("@/lib/ai/tools/brain", () => ({ brainTools: {} }));
vi.mock("@/lib/ai/tools/tasks", () => ({
  tasksTools: {
    getTasks: {
      description: "Get tasks",
      execute: (...args: any[]) => mockGetTasks(...args),
    },
    completeTask: {
      description: "Complete task",
      execute: (...args: any[]) => mockCompleteTask(...args),
    },
  },
}));
vi.mock("@/lib/ai/tools/business", () => ({ businessTools: {} }));
vi.mock("@/lib/ai/tools/content", () => ({ contentTools: {} }));
vi.mock("@/lib/ai/tools/social", () => ({ socialTools: {} }));
vi.mock("@/lib/ai/tools/system", () => ({ systemTools: {} }));
vi.mock("@/lib/ai/tools/meta", () => ({ metaTools: {} }));

import { nourTools } from "@/lib/ai/tools";

describe("wrapToolsWithEmptyHandling", () => {
  it("intercepts empty arrays returned by query tools and wraps them", async () => {
    mockGetTasks.mockResolvedValue([]);
    const res = await (nourTools as any).getTasks.execute({});
    expect(res).toEqual({
      success: true,
      count: 0,
      data: [],
      status: "no_data_found",
      message: "Query completed successfully, but zero matching records were found.",
    });
  });

  it("intercepts empty data arrays returned by query tools and wraps them", async () => {
    mockGetTasks.mockResolvedValue({ success: true, data: [] });
    const res = await (nourTools as any).getTasks.execute({});
    expect(res).toEqual({
      success: true,
      count: 0,
      data: [],
      status: "no_data_found",
      message: "Query completed successfully, but zero matching records were found.",
    });
  });

  it("does not intercept non-empty array results", async () => {
    const data = [{ id: "task-1", title: "Test task" }];
    mockGetTasks.mockResolvedValue(data);
    const res = await (nourTools as any).getTasks.execute({});
    expect(res).toBe(data);
  });

  it("does not intercept non-query tools that return empty results", async () => {
    mockCompleteTask.mockResolvedValue({ success: true });
    const res = await (nourTools as any).completeTask.execute({ taskId: "123" });
    expect(res).toEqual({ success: true });
  });
});
