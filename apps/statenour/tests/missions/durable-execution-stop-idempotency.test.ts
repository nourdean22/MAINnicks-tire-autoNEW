/**
 * Durable missions: stop + enqueue idempotency (audit 01-F3, 2026-10-10).
 *
 * Before: every enqueue minted a random runId and an id-less event, so a
 * retried tool call ran the whole mission twice; and nothing could stop a
 * queued or running mission (no cancelOn, no cancel sender).
 *
 * Three behaviours, each asserted where it takes effect:
 *   1. the SAME mission + objective sends the SAME Inngest event id and the
 *      same runId (Inngest drops a repeated event id for 24 h), while a
 *      different objective does not collide;
 *   2. cancelMissionExecution sends the event the function listens for;
 *   3. the function config halts on that event for the SAME mission only,
 *      and never runs two copies of one mission at once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  send: vi.fn(),
  createFunction: vi.fn(),
  missionFindFirst: vi.fn(),
  recordEpisode: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: true }) }));
vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ send: state.send, createFunction: state.createFunction }),
  isInngestFullyConfigured: () => state.configured,
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: { findFirst: (...a: unknown[]) => state.missionFindFirst(...a) },
    realityEvent: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/intelligence/episodes", () => ({
  recordEpisode: (...a: unknown[]) => state.recordEpisode(...a),
}));

import {
  cancelMissionExecution,
  queueDurableMissionExecution,
} from "@/lib/missions/durable-execution";

const input = {
  missionId: "m1",
  objective: "Research and checkpoint the migration plan",
  requestedBy: "operator" as const,
  steps: [{ id: "cp1", label: "Checkpoint", kind: "checkpoint" as const }],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.configured = true;
  state.missionFindFirst.mockResolvedValue({ id: "m1" });
  state.send.mockResolvedValue({ ids: ["evt-1"] });
  state.recordEpisode.mockResolvedValue(true);
});

describe("enqueue idempotency", () => {
  it("a second enqueue of the same mission + objective sends the same event id and runId", async () => {
    const first = await queueDurableMissionExecution(input);
    const second = await queueDurableMissionExecution(input);

    const [a, b] = state.send.mock.calls.map((c) => c[0] as { id?: string; data: { runId: string } });
    expect(a.id, "an id-less event is never deduplicated").toEqual(expect.any(String));
    expect(b.id).toBe(a.id);
    expect(b.data.runId).toBe(a.data.runId);
    expect(first).toMatchObject({ queued: true, runId: a.data.runId });
    expect(second).toMatchObject({ queued: true, runId: a.data.runId });
  });

  it("CONTROL: a different objective (or mission) gets a different event id", async () => {
    await queueDurableMissionExecution(input);
    await queueDurableMissionExecution({ ...input, objective: "Another objective entirely" });
    state.missionFindFirst.mockResolvedValueOnce({ id: "m2" });
    await queueDurableMissionExecution({ ...input, missionId: "m2" });
    const ids = state.send.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(3);
  });

  it("the deterministic runId still satisfies the event schema (uuid)", async () => {
    const { DurableMissionEventSchema } = await import("@/lib/missions/durable-execution");
    await queueDurableMissionExecution(input);
    const data = (state.send.mock.calls[0]![0] as { data: unknown }).data;
    expect(() => DurableMissionEventSchema.parse(data)).not.toThrow();
  });
});

describe("cancel", () => {
  it("sends the cancel event for that mission", async () => {
    const result = await cancelMissionExecution("m1");
    expect(state.send).toHaveBeenCalledWith({
      name: "mission/execution.cancelled",
      data: { missionId: "m1" },
    });
    expect(result).toEqual({ cancelRequested: true, missionId: "m1", eventIds: ["evt-1"] });
  });

  it("fails closed (no send) when Inngest is not configured", async () => {
    state.configured = false;
    expect(await cancelMissionExecution("m1")).toEqual({
      cancelRequested: false,
      reason: "inngest_not_configured",
    });
    expect(state.send).not.toHaveBeenCalled();
  });
});

describe("function config", () => {
  it("cancels on the cancel event for the SAME mission and runs one copy per mission", async () => {
    vi.resetModules();
    await import("@/lib/inngest/functions/mission-execution");
    const config = state.createFunction.mock.calls.at(-1)![0] as {
      triggers: Array<{ event: string }>;
      cancelOn?: Array<{ event: string; if?: string }>;
      singleton?: { key?: string; mode: string };
    };
    expect(config.triggers).toEqual([{ event: "mission/execution.requested" }]);
    expect(config.cancelOn).toEqual([
      { event: "mission/execution.cancelled", if: "event.data.missionId == async.data.missionId" },
    ]);
    expect(config.singleton).toEqual({ key: "event.data.missionId", mode: "skip" });
  });
});
