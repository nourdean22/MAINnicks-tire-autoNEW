/**
 * 2026-10-10 · a Private Lab turn leaves no trace: buildContextHints must not
 * write the cross_device_anchors_latest BrainMemory row when page anchors ride
 * along on a private turn (gate.ts contract: "no BrainMemory"). The row is also
 * READ by later anchor-less turns on any device, so a private write would steer
 * them. The route publishes privateMode on the turn before this runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  brainMemory: { upsert: vi.fn(async () => ({})), findFirst: vi.fn(async () => null) },
  task: { findFirst: vi.fn(async () => null) },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { buildContextHints } from "@/app/api/ai/chat/context-hints";
import { withTurnContext } from "@/lib/agent/turn-context";

const input = {
  messageCount: 2,
  contextRoute: "/tasks",
  lastTaskId: "t1",
  lastGoalId: undefined,
  lastSuggestionKind: undefined,
  lastSuggestionId: undefined,
  lastJournalEntryId: undefined,
  lastDecisionId: undefined,
  lastPinId: undefined,
  lastReflectionId: undefined,
  lastMissionId: undefined,
};

beforeEach(() => vi.clearAllMocks());

describe("buildContextHints · cross-device anchor write", () => {
  it("a Private Lab turn with a page anchor writes no BrainMemory row", async () => {
    await withTurnContext({ privateMode: true }, () => buildContextHints(input));
    expect(prismaMock.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("CONTROL · a normal turn with the same anchor writes the latest-anchors row once", async () => {
    await withTurnContext({}, () => buildContextHints(input));
    expect(prismaMock.brainMemory.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.brainMemory.upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "cross_device_anchors_latest" },
    });
  });

  it("CONTROL · the private turn still gets its live hint block (only the write is skipped)", async () => {
    const block = await withTurnContext({ privateMode: true }, () => buildContextHints(input));
    expect(block).toContain("t1");
  });
});
