/**
 * Durable missions: an enqueue while a run is in flight (audit B7, 2026-10-10).
 *
 * Before: the Inngest function's `singleton: { mode: "skip" }` silently
 * dropped a second request for a mission that was already running, but
 * queueDurableMissionExecution still returned queued:true and wrote a
 * "queued" episode for a run that would never start.
 *
 * Now enqueue reads the run marker it already writes (the latest
 * episode.mission.* row for that mission). In flight = a non-terminal phase
 * observed recently. Then: queued:false, no send, no new episode.
 *
 * The exclusivity itself stays Inngest's (singleton + event id); this read
 * only makes the reply honest, so it is a plain read, not a compare-and-swap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  send: vi.fn(),
  missionFindFirst: vi.fn(),
  realityFindFirst: vi.fn(),
  recordEpisode: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: true }) }));
vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ send: state.send }),
  isInngestFullyConfigured: () => true,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: { findFirst: (...a: unknown[]) => state.missionFindFirst(...a) },
    realityEvent: { findFirst: (...a: unknown[]) => state.realityFindFirst(...a) },
  },
}));
vi.mock("@/lib/intelligence/episodes", () => ({
  recordEpisode: (...a: unknown[]) => state.recordEpisode(...a),
}));

import {
  cancelMissionExecution,
  DurableMissionEventSchema,
  queueDurableMissionExecution,
} from "@/lib/missions/durable-execution";

type SentEvent = { id: string; data: { runId: string } };

const input = {
  missionId: "m1",
  objective: "Research and checkpoint the migration plan",
  requestedBy: "nick" as const,
  steps: [{ id: "cp1", label: "Checkpoint", kind: "checkpoint" as const }],
};

function latest(phase: string, agoMs = 60_000) {
  state.realityFindFirst.mockResolvedValueOnce({
    eventType: `episode.mission.${phase}`,
    observedAt: new Date(Date.now() - agoMs),
    payload: { episodeId: "run-1", missionId: "m1", metadata: null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps unconsumed *Once values; a test that throws before
  // the read would leak its marker into the next test.
  state.realityFindFirst.mockReset();
  state.missionFindFirst.mockResolvedValue({ id: "m1" });
  state.send.mockResolvedValue({ ids: ["evt-1"] });
  state.recordEpisode.mockResolvedValue(true);
});

describe("enqueue while a run is in flight", () => {
  for (const phase of ["queued", "started", "step_started", "step_completed"]) {
    it(`latest phase ${phase} -> queued:false, no send, no new queued episode`, async () => {
      latest(phase);
      // The reply names the run that is actually going (01-F3), so Nick can reference it.
      expect(await queueDurableMissionExecution(input)).toEqual({
        queued: false,
        reason: "already_running",
        runId: "run-1",
      });
      expect(state.send).not.toHaveBeenCalled();
      expect(state.recordEpisode).not.toHaveBeenCalled();
    });
  }

  it("reads the marker for THIS mission", async () => {
    latest("started");
    await queueDurableMissionExecution(input);
    expect(state.realityFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payload: { path: ["missionId"], equals: "m1" },
        }),
      }),
    );
  });

  for (const phase of ["completed", "attempt_failed", "cancel_requested"]) {
    it(`CONTROL: a terminal latest phase (${phase}) queues normally`, async () => {
      latest(phase);
      expect(await queueDurableMissionExecution(input)).toMatchObject({ queued: true });
      expect(state.send).toHaveBeenCalledTimes(1);
      expect(state.recordEpisode).toHaveBeenCalledWith(expect.objectContaining({ phase: "queued" }));
    });
  }

  it("CONTROL: no prior run queues normally", async () => {
    state.realityFindFirst.mockResolvedValueOnce(null);
    expect(await queueDurableMissionExecution(input)).toMatchObject({ queued: true });
  });

  it("a stale in-flight marker (no episode for 2 h, e.g. a cancelled run) does not block forever", async () => {
    latest("step_started", 2 * 60 * 60_000);
    expect(await queueDurableMissionExecution(input)).toMatchObject({ queued: true });
  });

  it("a FAILED marker read is not 'nothing running': it throws, nothing is sent", async () => {
    state.realityFindFirst.mockRejectedValueOnce(new Error("db down"));
    await expect(queueDurableMissionExecution(input)).rejects.toThrow("db down");
    expect(state.send).not.toHaveBeenCalled();
    expect(state.recordEpisode).not.toHaveBeenCalled();
  });
});

// Fix round (B7 review): Inngest drops a repeated event id for 24 h. With an
// id hashed from mission + objective only, pause -> resume -> re-queue the
// same objective was dropped, still replied queued:true, and its "queued"
// marker then read as already_running for 30 min. The id now also hashes the
// marker enqueue read, so a re-run after a finished run is a new run.
describe("a re-run after a finished run is a new Inngest event", () => {
  function marker(phase: string, runId: string, observedAt: Date) {
    return {
      eventType: `episode.mission.${phase}`,
      observedAt,
      payload: { episodeId: runId, missionId: "m1", metadata: null },
    };
  }

  for (const phase of ["cancel_requested", "completed", "attempt_failed"]) {
    it(`latest ${phase} for run R -> the re-queue sends a fresh event id and runId`, async () => {
      state.realityFindFirst.mockResolvedValueOnce(null);
      await queueDurableMissionExecution(input);
      const first = state.send.mock.calls[0]![0] as SentEvent;

      state.realityFindFirst.mockResolvedValueOnce(
        marker(phase, first.data.runId, new Date(Date.now() - 60_000)),
      );
      const result = await queueDurableMissionExecution(input);
      const second = state.send.mock.calls[1]![0] as SentEvent;

      expect(second.id).not.toBe(first.id);
      expect(second.data.runId).not.toBe(first.data.runId);
      expect(result).toMatchObject({ queued: true, runId: second.data.runId });
      expect(() => DurableMissionEventSchema.parse(second.data)).not.toThrow();
    });
  }

  it("CONTROL: two enqueues that read the SAME marker send the same id and runId (a racing retry still dedupes)", async () => {
    const seen = marker("completed", "run-0", new Date("2026-10-10T12:00:00Z"));
    state.realityFindFirst.mockResolvedValueOnce(seen).mockResolvedValueOnce(seen);
    await queueDurableMissionExecution(input);
    await queueDurableMissionExecution(input);
    const [a, b] = state.send.mock.calls.map((c) => c[0] as SentEvent);
    expect(b.id).toBe(a.id);
    expect(b.data.runId).toBe(a.data.runId);
  });
});

// A cancelled run writes no terminal episode of its own (Inngest halts it
// between steps), so without this marker the re-enqueue above would read the
// dead run as in flight until the gap expired.
describe("cancel marks the in-flight run", () => {
  it("records cancel_requested on the in-flight run after the cancel is accepted", async () => {
    latest("step_started");
    expect(await cancelMissionExecution("m1")).toEqual({
      cancelRequested: true,
      missionId: "m1",
      eventIds: ["evt-1"],
    });
    expect(state.recordEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "mission",
        phase: "cancel_requested",
        episodeId: "run-1",
        missionId: "m1",
      }),
    );
  });

  it("CONTROL: no in-flight run, no marker (a finished run is not relabelled)", async () => {
    latest("completed");
    await cancelMissionExecution("m1");
    expect(state.recordEpisode).not.toHaveBeenCalled();
  });

  it("a rejected cancel send records nothing", async () => {
    latest("step_started");
    state.send.mockRejectedValueOnce(new Error("inngest 500"));
    await expect(cancelMissionExecution("m1")).rejects.toThrow("inngest 500");
    expect(state.recordEpisode).not.toHaveBeenCalled();
  });

  it("a failed marker READ does not turn an accepted cancel into a rejection", async () => {
    state.realityFindFirst.mockRejectedValueOnce(new Error("db down"));
    expect(await cancelMissionExecution("m1")).toMatchObject({ cancelRequested: true });
    expect(state.recordEpisode).not.toHaveBeenCalled();
  });

  it("a failed marker write does not undo the accepted cancel", async () => {
    latest("step_started");
    state.recordEpisode.mockRejectedValueOnce(new Error("ledger down"));
    expect(await cancelMissionExecution("m1")).toMatchObject({ cancelRequested: true });
  });
});
