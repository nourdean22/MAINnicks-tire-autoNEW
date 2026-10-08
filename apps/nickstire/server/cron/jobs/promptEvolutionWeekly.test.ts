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
    // 9c6b591d renamed "ACCEPTED": an offline holdout pass is not a production
    // winner, and the message must say so.
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("OFFLINE CANDIDATE"));
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("NOT a production/business winner"));
  });

  it("Monday + gate rejection → quiet zero with the outcome named, Telegram still informs", async () => {
    mocks.runPromptEvolution.mockResolvedValue({ ...accepted, accepted: null, outcome: "rejected-holdout" });
    const r = await processPromptEvolutionWeekly(new Date("2026-08-03T15:00:00Z"));
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("rejected-holdout");
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("gate held"));
  });

  it("Monday + an infrastructure failure (no DB, dead LLM lane) fails the cron run — no kv row, no Telegram, never a quiet zero", async () => {
    mocks.runPromptEvolution.mockRejectedValue(new Error("only 2 usable seeds — need >= 4"));
    await expect(processPromptEvolutionWeekly(new Date("2026-08-03T15:00:00Z"))).rejects.toThrow("usable seeds");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sendTelegram).not.toHaveBeenCalled();
  });

  it("Monday + a holdout reading → cron_log details and Telegram carry the gate's reason and numbers", async () => {
    const gate = {
      accept: false, reason: "regressed-seed" as const, comparable: 12, improved: 5, worsened: 1, tied: 6,
      pValue: 0.04, bestPossibleP: 1 / 4096, baselineSelfDisagreement: 3, regressedSeeds: ["call-7"],
      baseline: { passes: 12, trials: 36 }, candidate: { passes: 25, trials: 36 },
    };
    mocks.runPromptEvolution.mockResolvedValue({ ...accepted, accepted: null, gate, outcome: "rejected-regression" });
    const r = await processPromptEvolutionWeekly(new Date("2026-08-03T15:00:00Z"));
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("gate regressed-seed +5/-1 p=0.040");
    expect(mocks.sendTelegram).toHaveBeenCalledWith(expect.stringContaining("regressed call-7"));
  });
});
