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

/**
 * THE GATE IS WIRED · added 2026-08-23.
 *
 * The next-action gate (lib/services/subtask-validator.ts) has thorough unit
 * tests of its own. Those tests do NOT prove it is called: deleting the
 * `filterGeneratedSubtasks` block from decomposeTaskWithAi left all of them
 * green, and the live artefact — "Decide on action for the open loop" and four
 * siblings — could have shipped again with a fully green suite. Unit tests are
 * the control; this is the canary.
 *
 * These drive the real decomposeTaskWithAi through the harness above and assert
 * on prisma.task.create, which is the only thing the operator ever sees.
 */
describe("decomposeTaskWithAi · the next-action gate is actually applied", () => {
  // Verbatim from prod, task cmt2efxsu0181p301kj5s5pfp, 2026-08-23T07:03:03Z.
  const LIVE_ARTEFACT = [
    { title: "Decide on action for the open loop", nextAction: "decide", effort: "M15", context: "DESK" },
    { title: "Create recurring Monday calendar event", nextAction: "open calendar", effort: "M15", context: "DESK" },
    { title: "Delegate the recurring task to shop manager", nextAction: "text him", effort: "M15", context: "DESK" },
    { title: "Close the open loop", nextAction: "close it", effort: "M15", context: "DESK" },
    { title: "Update task tracker with outcome", nextAction: "update", effort: "M15", context: "DESK" },
  ];

  it("THE ARTEFACT: creates NOTHING and says why", async () => {
    mocks.tracedAiChat.mockResolvedValue({ provider: "openai", content: JSON.stringify(LIVE_ARTEFACT) });

    const res = await decomposeTaskWithAi("t1");

    expect(mocks.task.create, "not one row may be written").not.toHaveBeenCalled();
    expect(res.subtasksCount).toBe(0);
    expect(res.suppressed).toBe(true);
    expect(res.suppressedReason).toBe("alternatives_not_steps");
  });

  it("suppression is DISTINGUISHABLE from an empty plan — the orchestrator branches on it", async () => {
    // autonomic-orchestrator flips the parent to WAITING and posts a P1
    // "Task Healed" on ok alone. Both shapes are { ok: true, subtasksCount: 0 },
    // so without `suppressed` a refused batch reads as a successful heal — and
    // the parent then drops out of the healer's own status:DOING selector and is
    // parked forever, announced as fixed.
    mocks.tracedAiChat.mockResolvedValue({ provider: "openai", content: "[]" });
    const empty = await decomposeTaskWithAi("t1");
    expect(empty.suppressed).toBeUndefined();

    mocks.tracedAiChat.mockResolvedValue({ provider: "openai", content: JSON.stringify(LIVE_ARTEFACT) });
    const gated = await decomposeTaskWithAi("t1");
    expect(gated.suppressed).toBe(true);
  });

  it("POSITIVE CONTROL: a batch of real physical actions still creates every row", async () => {
    // Without this, a gate that suppressed EVERYTHING would pass the two tests
    // above while silently disabling decomposition across the product.
    mocks.tracedAiChat.mockResolvedValue({
      provider: "openai",
      content: JSON.stringify([
        { title: "Call the supplier about the winter order", nextAction: "call", effort: "M15", context: "PHONE" },
        { title: "Print the updated price sheet", nextAction: "print", effort: "M15", context: "DESK" },
        { title: "Delegate the tire rotation to Mike", nextAction: "ask", effort: "M15", context: "SHOP" },
      ]),
    });

    const res = await decomposeTaskWithAi("t1");

    expect(res.subtasksCount).toBe(3);
    expect(res.suppressed).toBeUndefined();
    expect(mocks.task.create).toHaveBeenCalledTimes(3);
  });

  it("energy comes from the model, not a hardcode", async () => {
    // energyRequired was literally `"MEDIUM"` in the insert — not in the prompt,
    // not in the schema. Measured: 12 of 12 AI-generated subtasks MEDIUM, 0.00
    // bits — against a base rate over ALL tasks of MEDIUM 82.7% / LOW 11.8% /
    // HIGH 5.5%, about 0.82 bits.
    //
    // Both halves are load-bearing. The column is NOT dead: it varies fine when a
    // human sets it. The defect was confined to the generator, and quoting the
    // 0.00 without the 0.82 would have condemned a working column — the filtered
    // -population error the base-rate-check skill exists for.
    mocks.tracedAiChat.mockResolvedValue({
      provider: "openai",
      content: JSON.stringify([
        { title: "Call the supplier about the winter order", nextAction: "call", effort: "M15", context: "PHONE", energy: "HIGH" },
        { title: "Print the updated price sheet", nextAction: "print", effort: "M15", context: "DESK", energy: "LOW" },
      ]),
    });

    await decomposeTaskWithAi("t1");

    expect(mocks.task.create.mock.calls[0][0].data.energyRequired).toBe("HIGH");
    expect(mocks.task.create.mock.calls[1][0].data.energyRequired).toBe("LOW");
  });

  it("energy falls back to MEDIUM when the model omits it — old behaviour preserved", async () => {
    mocks.tracedAiChat.mockResolvedValue({
      provider: "openai",
      content: JSON.stringify([
        { title: "Call the supplier about the winter order", nextAction: "call", effort: "M15", context: "PHONE" },
        { title: "Print the updated price sheet", nextAction: "print", effort: "M15", context: "DESK" },
      ]),
    });

    await decomposeTaskWithAi("t1");

    expect(mocks.task.create.mock.calls[0][0].data.energyRequired).toBe("MEDIUM");
  });
});
