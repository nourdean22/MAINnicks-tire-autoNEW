/**
 * recentPromptExperiments + toPromptExperimentRow (2026-10-09): the read side
 * of `receptionist.prompt_experiment` behind the /proof section.
 *
 * Three states, never two (skill empty-vs-error): a successful read with rows,
 * a successful read with NO rows (a measured "none yet"), and an unavailable
 * read (not migrated, or any other failure). The last must never come back as
 * an empty list, and must never throw into the page.
 *
 * Fixtures use the producer's real shape (nickstire promptEvolutionReceipt.ts:
 * every gate is { reason, pValue, bestPossibleP, comparable, improved,
 * worsened, tied }, lanes.parity is a boolean, differences are strings) and a
 * DISTINCT value in every cohort slot, so a swapped field cannot pass.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { realityEvent: { findMany } } }));

import {
  RECEPTIONIST_EXPERIMENT_EVENT_TYPE,
  recentPromptExperiments,
  toPromptExperimentRow,
} from "@/lib/services/reality-ledger";

const fullRow = {
  id: "evt_1",
  occurredAt: new Date("2026-10-12T13:33:00.000Z"),
  observedAt: new Date("2026-10-12T13:33:02.000Z"),
  objects: [
    { type: "experiment", id: "prompt-evolution:9f2c4e1ab07d3e55" },
    { type: "assistant_prompt", id: "a1b2c3d4e5f6a7b8c9d0e1f2", role: "baseline" },
  ],
  payload: {
    outcome: "accepted",
    promotionStage: "offline_candidate",
    baseline: { source: "live_provider", promptHash: "a1b2c3d4e5f6a7b8c9d0e1f2", parity: "identical" },
    candidate: { promptHash: "e5f6a7b8c9d0e1f2a3b4c5d6" },
    lanes: { parity: true, differences: [] },
    cohorts: { train: 14, holdout: 12, confirm: 6, success: 10 },
    gates: {
      holdout: { reason: "improved", pValue: 0.031, bestPossibleP: 0.001, comparable: 11, improved: 6, worsened: 0, tied: 5 },
      success: { reason: "preserved", pValue: 0.75, bestPossibleP: 0.002, comparable: 9, improved: 1, worsened: 0, tied: 8 },
      confirmation: { reason: "regressed-seed", pValue: 0.5, bestPossibleP: 0.031, comparable: 5, improved: 1, worsened: 2, tied: 2 },
    },
    previousProposal: { status: "applied" },
    usage: { durationMs: 118618, replays: 72 },
  },
};

const missingTable = () => Object.assign(new Error("The table `public.reality_events` does not exist in the current database."), { code: "P2021" });
const notRun = { ran: false, verdict: null, pValue: null, comparable: null, improved: null, worsened: null };

beforeEach(() => {
  findMany.mockReset();
});

describe("toPromptExperimentRow", () => {
  it("maps every field of a full producer receipt, each cohort and gate to its own slot", () => {
    expect(toPromptExperimentRow(fullRow)).toEqual({
      id: "evt_1",
      experimentId: "prompt-evolution:9f2c4e1ab07d3e55",
      occurredAt: "2026-10-12T13:33:00.000Z",
      outcome: "accepted",
      promotionStage: "offline_candidate",
      cohorts: { train: 14, holdout: 12, confirm: 6, success: 10 },
      holdout: { ran: true, verdict: "improved", pValue: 0.031, comparable: 11, improved: 6, worsened: 0 },
      success: { ran: true, verdict: "preserved", pValue: 0.75, comparable: 9, improved: 1, worsened: 0 },
      confirmation: { ran: true, verdict: "regressed-seed", pValue: 0.5, comparable: 5, improved: 1, worsened: 2 },
      laneParity: "match",
      laneDifferences: [],
      previousProposalStatus: "applied",
    });
  });

  it("missing optional gates and keys map to not-run / null / unknown, never to zeros or a pass", () => {
    const row = toPromptExperimentRow({
      id: "evt_2",
      observedAt: "2026-10-05T13:33:00.000Z",
      objects: [{ type: "run", id: "x" }],
      payload: { outcome: "no-candidate", gates: { holdout: null } },
    });
    expect(row).toMatchObject({
      experimentId: null,
      occurredAt: "2026-10-05T13:33:00.000Z",
      outcome: "no-candidate",
      promotionStage: null,
      cohorts: { train: null, holdout: null, confirm: null, success: null },
      laneParity: "unknown",
      laneDifferences: [],
      previousProposalStatus: null,
    });
    for (const gate of [row.holdout, row.success, row.confirmation]) expect(gate).toEqual(notRun);
  });

  it("a gate that ran with no readable reason is ran:true, verdict null (unknown), its numbers kept", () => {
    const row = toPromptExperimentRow({ id: "e", observedAt: new Date(0), objects: [], payload: { outcome: "x", gates: { holdout: { pValue: 0.2 } } } });
    expect(row.holdout).toEqual({ ran: true, verdict: null, pValue: 0.2, comparable: null, improved: null, worsened: null });
  });

  it("keys the producer never writes are NOT read as a verdict: { accept: true } is unknown, never a pass", () => {
    const row = toPromptExperimentRow({
      id: "e",
      observedAt: new Date(0),
      objects: [],
      payload: { outcome: "x", gates: { holdout: { accept: true }, success: { verdict: "pass" }, confirmation: { status: "passed", passed: true } } },
    });
    for (const gate of [row.holdout, row.success, row.confirmation]) expect(gate.verdict).toBeNull();
  });

  it("a garbage payload (null, array, wrong types) does not throw", () => {
    for (const payload of [null, [], "x", { gates: "nope", cohorts: [1], lanes: 7, previousProposal: "applied" }]) {
      const row = toPromptExperimentRow({ id: "evt_3", observedAt: new Date(0), objects: null, payload });
      expect(row.outcome).toBeNull();
      expect(row.holdout.ran).toBe(false);
      expect(row.previousProposalStatus).toBeNull();
    }
  });

  it("lane parity: true is match; false or any listed difference is mismatch; anything else is unknown", () => {
    const lanes = (l: unknown) => toPromptExperimentRow({ id: "e", observedAt: new Date(0), objects: [], payload: { outcome: "x", lanes: l } });
    expect(lanes({ parity: true }).laneParity).toBe("match");
    expect(lanes({ parity: false }).laneParity).toBe("mismatch");
    // Not a producer value: never promoted to "match" by a truthy-looking string.
    expect(lanes({ parity: "match" }).laneParity).toBe("unknown");
    const differs = lanes({ differences: ["model", { field: "temperature" }, 3, "maxTokens"] });
    expect(differs.laneParity).toBe("mismatch");
    expect(differs.laneDifferences).toEqual(["model", "maxTokens"]);
  });
});

describe("recentPromptExperiments", () => {
  it("positive control: reads only receptionist experiments, newest RECEIVED first, and maps the rows", async () => {
    findMany.mockResolvedValueOnce([fullRow]);
    const r = await recentPromptExperiments(8);
    expect(r).toEqual({ status: "ok", rows: [toPromptExperimentRow(fullRow)] });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventType: RECEPTIONIST_EXPERIMENT_EVENT_TYPE },
        // server-set createdAt, not the producer-supplied occurredAt: a
        // far-future occurredAt must not hold the top row forever
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    );
  });

  it("clamps the limit to 1..50", async () => {
    findMany.mockResolvedValue([]);
    await recentPromptExperiments(500);
    await recentPromptExperiments(-3);
    expect(findMany.mock.calls.map((c) => c[0].take)).toEqual([50, 1]);
  });

  it("an empty ledger is a MEASURED empty: ok with no rows", async () => {
    findMany.mockResolvedValueOnce([]);
    expect(await recentPromptExperiments()).toEqual({ status: "ok", rows: [] });
  });

  it("a missing ledger table (P2021) is unavailable/not_migrated, never an empty list", async () => {
    findMany.mockRejectedValueOnce(missingTable());
    expect(await recentPromptExperiments()).toEqual({ status: "unavailable", reason: "not_migrated" });
  });

  it("any other read failure is unavailable/read_failed and does not throw into the page", async () => {
    findMany.mockRejectedValueOnce(new Error("connection reset"));
    const r = await recentPromptExperiments();
    expect(r).toEqual({ status: "unavailable", reason: "read_failed" });
    expect(r).not.toHaveProperty("rows");
  });
});
