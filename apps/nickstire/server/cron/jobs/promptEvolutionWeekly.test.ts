/**
 * Weekly prompt evolution · doctrine tests.
 *
 * Pins: the Monday self-gate emits the whole-run-skip vocabulary (so the
 * loop-shape observer never reads six quiet days as dormancy), an accepted
 * result persists to kv + Telegram, and a gate rejection is a quiet zero,
 * never an error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runPromptEvolution: vi.fn(),
  sendTelegram: vi.fn().mockResolvedValue(true),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("../../services/promptEvolution", () => ({ runPromptEvolution: mocks.runPromptEvolution }));
vi.mock("../../services/telegram", () => ({ sendTelegram: mocks.sendTelegram }));
vi.mock("../../db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: async (v: unknown) => mocks.insert(v) }),
    update: () => ({ set: () => ({ where: async () => mocks.update() }) }),
  }),
}));

import { processPromptEvolutionWeekly } from "./promptEvolutionWeekly";
import { looksSkipped } from "../../services/loopShapeContract";

const accepted = {
  usableSeeds: 12, trainCount: 6, holdoutCount: 6,
  baselineTrain: "1/6", baselineHoldout: "2/6",
  candidateSummaries: [{ rationale: "r", train: "3/6" }],
  accepted: { rationale: "better transfer handling", holdout: "4/6", prompt: "x".repeat(300) },
  outcome: "accepted" as const,
};

describe("processPromptEvolutionWeekly", () => {
  beforeEach(() => vi.clearAllMocks());

  it("non-Monday emits the whole-run-skip vocabulary the shape observer excludes", async () => {
    const r = await processPromptEvolutionWeekly(new Date("2026-08-05T15:00:00Z")); // a Wednesday
    expect(r.recordsProcessed).toBe(0);
    expect(looksSkipped(r.details)).toBe(true);
    expect(mocks.runPromptEvolution).not.toHaveBeenCalled();
  });

  it("Monday + accepted → kv persisted, Telegram sent, recordsProcessed 1", async () => {
    mocks.runPromptEvolution.mockResolvedValue(accepted);
    const r = await processPromptEvolutionWeekly(new Date("2026-08-03T15:00:00Z")); // a Monday
    expect(r.recordsProcessed).toBe(1);
    expect(r.details).toContain("accepted");
    expect(mocks.insert).toHaveBeenCalled(); // kv row written
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("ACCEPTED"));
  });

  it("Monday + gate rejection → quiet zero with the outcome named, Telegram still informs", async () => {
    mocks.runPromptEvolution.mockResolvedValue({ ...accepted, accepted: null, outcome: "rejected-holdout" });
    const r = await processPromptEvolutionWeekly(new Date("2026-08-03T15:00:00Z"));
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("rejected-holdout");
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("gate held"));
  });
});
