/**
 * Durable missions: stop + enqueue idempotency (audit 01-F3, 2026-10-10).
 *
 * Before: every enqueue minted a random runId and an id-less event, so a
 * retried tool call ran the whole mission twice; and nothing could stop a
 * queued or running mission (no cancelOn, no cancel sender).
 *
 * Three behaviours, each asserted where it takes effect:
 *   1. a re-enqueue of the SAME mission + objective while the first run is in
 *      flight sends nothing and names the in-flight runId, every event
 *      carries an id (Inngest drops a repeated event id for 24 h), and a
 *      different objective does not collide;
 *   2. cancelMissionExecution sends the event the function listens for, and
 *      says so when its cancel marker was not recorded;
 *   3. the function config halts on that event for the SAME mission only,
 *      and never runs two copies of one mission at once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Marker = {
  eventType: string;
  observedAt: Date;
  payload: { episodeId: string; missionId: string; metadata: null };
};

const state = vi.hoisted(() => ({
  configured: true,
  send: vi.fn(),
  createFunction: vi.fn(),
  missionFindFirst: vi.fn(),
  recordEpisode: vi.fn(),
  logWarn: vi.fn(),
  // The run markers recordEpisode wrote, oldest first. realityEvent.findFirst
  // reads them back the way getLatestMissionExecution reads the ledger, so the
  // second enqueue sees the marker the first one wrote.
  ledger: [] as Marker[],
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
    realityEvent: {
      findFirst: async (args: { where: { payload: { equals: string } } }) =>
        state.ledger.filter((m) => m.payload.missionId === args.where.payload.equals).at(-1) ?? null,
    },
  },
}));
vi.mock("@/lib/intelligence/episodes", () => ({
  recordEpisode: (...a: unknown[]) => state.recordEpisode(...a),
}));
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return {
    ...actual,
    logger: { ...actual.logger, withSurface: () => ({ ...actual.logger, warn: state.logWarn }) },
  };
});

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
  state.ledger.length = 0;
  state.recordEpisode.mockImplementation(
    async (e: { phase: string; episodeId: string; missionId: string }) => {
      state.ledger.push({
        eventType: `episode.mission.${e.phase}`,
        observedAt: new Date(),
        payload: { episodeId: e.episodeId, missionId: e.missionId, metadata: null },
      });
      return true;
    },
  );
});

describe("enqueue idempotency", () => {
  it("a re-enqueue of the same mission + objective while the first run is in flight returns the in-flight runId and sends nothing", async () => {
    const first = await queueDurableMissionExecution(input);
    const second = await queueDurableMissionExecution(input);

    expect(state.send).toHaveBeenCalledTimes(1);
    const a = state.send.mock.calls[0]![0] as { id?: string; data: { runId: string } };
    expect(a.id, "an id-less event is never deduplicated").toEqual(expect.any(String));
    expect(first).toMatchObject({ queued: true, runId: a.data.runId });
    expect(second).toEqual({ queued: false, reason: "already_running", runId: a.data.runId });
  });

  it("CONTROL: a different objective (or mission) gets a different event id", async () => {
    await queueDurableMissionExecution(input);
    state.ledger.length = 0; // nothing in flight: only the seed may tell them apart
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

  // recordEpisode returns false (no throw) when the ledger rejects the row.
  // Unmarked, the dead run reads as in flight to the next enqueue for 30 min.
  it("a ledger that REJECTS the cancel marker is said, not swallowed (the cancel still sends)", async () => {
    await queueDurableMissionExecution(input); // a run in flight
    const runId = (state.send.mock.calls[0]![0] as { data: { runId: string } }).data.runId;
    state.recordEpisode.mockResolvedValueOnce(false);

    expect(await cancelMissionExecution("m1")).toEqual({
      cancelRequested: true,
      missionId: "m1",
      eventIds: ["evt-1"],
      markerRecorded: false,
    });
    expect(state.send).toHaveBeenLastCalledWith({
      name: "mission/execution.cancelled",
      data: { missionId: "m1" },
    });
    expect(state.recordEpisode).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "cancel_requested", episodeId: runId }),
    );
    expect(state.logWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ missionId: "m1", runId }),
    );
  });

  it("a thrown marker write is said too", async () => {
    await queueDurableMissionExecution(input);
    state.recordEpisode.mockRejectedValueOnce(new Error("ledger down"));
    expect(await cancelMissionExecution("m1")).toMatchObject({
      cancelRequested: true,
      markerRecorded: false,
    });
  });

  it("CONTROL: a recorded marker adds no flag and logs nothing", async () => {
    await queueDurableMissionExecution(input);
    expect(await cancelMissionExecution("m1")).toEqual({
      cancelRequested: true,
      missionId: "m1",
      eventIds: ["evt-1"],
    });
    expect(state.ledger.at(-1)!.eventType).toBe("episode.mission.cancel_requested");
    expect(state.logWarn).not.toHaveBeenCalled();
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
