/**
 * tests/lib/services/ai-tasks-decompose.test.ts · missions-mediums wave
 * · 2026-07-16.
 *
 * Locks the failure contract of `decomposeTaskWithAi`: error-shaped
 * zero results must THROW (provider down · unparseable output · all
 * rows invalid) so callers can't toast "Successfully created 0
 * subtasks!" on a failure. A legitimately empty plan (model returns
 * `[]`) stays a success with subtasksCount 0.
 *
 * Mocks prisma + tracedAiChat · no real DB, no real provider.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  tracedAiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { task: mocks.task },
}));

vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: mocks.tracedAiChat,
}));

import { decomposeTaskWithAi } from "@/lib/services/ai-tasks";

const parentTask = {
  id: "t1",
  title: "Build the thing",
  effort: "H1",
  nextPhysicalAction: "open editor",
  context: "DESK",
  missionId: "m1",
  roiScore: 60,
  mission: { title: "Mission One" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.task.findUnique.mockResolvedValue(parentTask);
  mocks.task.create.mockImplementation(async ({ data }: { data: { title: string } }) => ({
    id: `sub-${data.title}`,
    ...data,
  }));
});

describe("decomposeTaskWithAi · failure contract", () => {
  it("throws when the provider is down (provider: none)", async () => {
    mocks.tracedAiChat.mockResolvedValue({ provider: "none", content: "" });
    await expect(decomposeTaskWithAi("t1")).rejects.toThrow(/provider unavailable/i);
    expect(mocks.task.create).not.toHaveBeenCalled();
  });

  it("throws when the provider is the emergency fallback", async () => {
    mocks.tracedAiChat.mockResolvedValue({ provider: "emergency", content: "sorry" });
    await expect(decomposeTaskWithAi("t1")).rejects.toThrow(/provider unavailable/i);
    expect(mocks.task.create).not.toHaveBeenCalled();
  });

  it("throws when the output is unparseable", async () => {
    mocks.tracedAiChat.mockResolvedValue({
      provider: "openai",
      content: "I cannot help with that.",
    });
    await expect(decomposeTaskWithAi("t1")).rejects.toThrow(/unparseable/i);
    expect(mocks.task.create).not.toHaveBeenCalled();
  });

  it("throws when every returned row fails validation", async () => {
    mocks.tracedAiChat.mockResolvedValue({
      provider: "openai",
      content: JSON.stringify([{ bogus: true }, { alsoBogus: 1 }]),
    });
    await expect(decomposeTaskWithAi("t1")).rejects.toThrow(/no valid subtasks/i);
    expect(mocks.task.create).not.toHaveBeenCalled();
  });

  it("a legitimately empty plan ([]) is success with 0", async () => {
    mocks.tracedAiChat.mockResolvedValue({
      provider: "openai",
      content: "[]",
    });
    const res = await decomposeTaskWithAi("t1");
    expect(res).toEqual({ ok: true, subtasksCount: 0 });
    expect(mocks.task.create).not.toHaveBeenCalled();
  });

  it("creates rows and reports the real count on success", async () => {
    mocks.tracedAiChat.mockResolvedValue({
      provider: "openai",
      content: JSON.stringify([
        { title: "Step 1", nextAction: "do a", effort: "M15", context: "DESK" },
        { title: "Step 2", nextAction: "do b", effort: "M30", context: "DESK" },
      ]),
    });
    const res = await decomposeTaskWithAi("t1");
    expect(res).toEqual({ ok: true, subtasksCount: 2 });
    expect(mocks.task.create).toHaveBeenCalledTimes(2);
    expect(mocks.task.create.mock.calls[0][0].data).toMatchObject({
      title: "Step 1",
      parentTaskId: "t1",
      missionId: "m1",
      status: "READY",
    });
  });
});
