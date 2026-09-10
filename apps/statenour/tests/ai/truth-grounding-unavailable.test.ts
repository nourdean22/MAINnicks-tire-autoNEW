/**
 * tests/ai/truth-grounding-unavailable.test.ts · 2026-09-10
 *
 * L4 promises, in its own header, that "the model can't claim 15 with a
 * contradicting fact in its system context." When the lookup THREW, there
 * was no contradicting fact and nothing said so -- the protection
 * evaporated silently on exactly the slow/broken-database turns where a
 * stale task count is most likely to be in the model's head.
 *
 * `groundMissionByName` returned `null` for three different reasons:
 * this entity is not a project (the ordinary case), it is an Inbox
 * catch-all, and the read failed. All three collapsed to "".
 *
 * The control is the important half. "Not a project" is what MOST turns
 * produce -- ENTITY_PATTERN matches any capitalised run -- so a notice
 * that fired on an empty result would fire constantly and train the
 * model to skip it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mission: { findFirst: vi.fn() },
  task: { count: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { mission: mocks.mission, task: mocks.task },
}));
vi.mock("@/lib/services/mission-helpers", () => ({ isInboxMission: () => false }));

import { buildTruthGroundingBlock, TRUTH_GROUNDING_UNAVAILABLE } from "@/lib/ai/chat/truth-grounding";

/** One user turn naming a capitalised entity the extractor will pick up. */
const MESSAGES = [
  { role: "user", parts: [{ type: "text", text: "how many tasks are on Bay Five right now" }] },
];

beforeEach(() => vi.clearAllMocks());

describe("a failed grounding lookup is declared, not silently dropped", () => {
  it("CANARY · the lookup throws => an explicit UNAVAILABLE block", async () => {
    mocks.mission.findFirst.mockRejectedValue(new Error("db down"));

    const block = await buildTruthGroundingBlock(MESSAGES as never);

    expect(block).toBe(TRUTH_GROUNDING_UNAVAILABLE);
    expect(block).toMatch(/UNAVAILABLE/);
    // The instruction, not just the status.
    expect(block).toMatch(/NOT evidence that a project has no tasks/i);
    expect(block).toMatch(/do not state a task count/i);
  });

  it("CANARY · a partial failure keeps verified facts and flags the gap", async () => {
    // First entity grounds, a later one throws. The fact that DID come
    // back is real and must stay; what is missing must not be read as
    // absence.
    let call = 0;
    mocks.mission.findFirst.mockImplementation(async () => {
      call += 1;
      if (call === 1) return { id: "m1", title: "Bay Five", status: "ACTIVE" };
      throw new Error("db down");
    });
    mocks.task.count.mockResolvedValue(3);

    const block = await buildTruthGroundingBlock([
      { role: "user", parts: [{ type: "text", text: "compare Bay Five and Garage Ops" }] },
    ] as never);

    expect(block).toMatch(/verified state at turn start/i);
    expect(block).toMatch(/Bay Five/);
    expect(block).toMatch(/PARTIAL/);
    expect(block).toMatch(/must not be asserted from memory/i);
  });
});

describe("CONTROL · the ordinary empty case stays silent", () => {
  it("entities that are simply not projects produce NO block", async () => {
    // This is most turns. A notice here would be wallpaper within a day.
    mocks.mission.findFirst.mockResolvedValue(null);

    const block = await buildTruthGroundingBlock(MESSAGES as never);

    expect(block).toBe("");
  });

  it("no entities at all produces NO block", async () => {
    const block = await buildTruthGroundingBlock([
      { role: "user", parts: [{ type: "text", text: "ok thanks" }] },
    ] as never);
    expect(block).toBe("");
    expect(mocks.mission.findFirst).not.toHaveBeenCalled();
  });

  it("a clean grounded fact carries no PARTIAL warning", async () => {
    mocks.mission.findFirst.mockResolvedValue({ id: "m1", title: "Bay Five", status: "ACTIVE" });
    mocks.task.count.mockResolvedValue(2);

    const block = await buildTruthGroundingBlock(MESSAGES as never);

    expect(block).toMatch(/verified state at turn start/i);
    expect(block).not.toMatch(/PARTIAL/);
    expect(block).not.toMatch(/UNAVAILABLE/);
  });
});
