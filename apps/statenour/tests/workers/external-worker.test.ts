import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runnerFindMany: vi.fn(),
  enqueue: vi.fn(),
  workItemFindUnique: vi.fn(),
  realityFindMany: vi.fn(),
  recordEpisode: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    runnerNode: {
      findMany: (...args: unknown[]) => state.runnerFindMany(...args),
    },
    workItem: {
      findUnique: (...args: unknown[]) => state.workItemFindUnique(...args),
    },
    realityEvent: {
      findMany: (...args: unknown[]) => state.realityFindMany(...args),
    },
  },
}));

vi.mock("@/lib/services/runner-state", () => ({
  enqueueWorkItem: (...args: unknown[]) => state.enqueue(...args),
}));

vi.mock("@/lib/intelligence/episodes", () => ({
  recordEpisode: (...args: unknown[]) => state.recordEpisode(...args),
}));

import {
  getExternalWorkerLaneSnapshots,
  queueExternalWorker,
} from "@/lib/workers/external-worker";

function heartbeat(lanes: Record<string, unknown>) {
  return {
    nodeKey: "external-worker:nattynour",
    lastHeartbeatAt: new Date(),
    metadata: { externalWorker: { lanes } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.runnerFindMany.mockResolvedValue([]);
  state.enqueue.mockResolvedValue({
    id: "job-1",
    type: "AI_EXTERNAL_WORKER",
  });
  state.recordEpisode.mockResolvedValue(true);
});

describe("NOUR external worker routing", () => {
  it("uses live heartbeat state and keeps subscription auth separate from API billing", async () => {
    state.runnerFindMany.mockResolvedValue([
      heartbeat({
        codex: {
          health: "ready",
          quota: "exhausted",
          auth: "ChatGPT",
        },
        "claude-code": {
          health: "ready",
          quota: "available",
          auth: "claude.ai/max",
        },
        antigravity: {
          health: "ready",
          quota: "available",
          auth: "Google account",
        },
        "local-qwen": {
          health: "ready",
          quota: "available",
          auth: "local",
        },
      }),
    ]);

    const result = await queueExternalWorker({
      prompt: "Review the repository architecture without changing any files.",
      capability: "coder",
      mode: "AUTO",
      requestedBy: "operator",
    });

    expect(result).toMatchObject({
      queued: true,
      selectedLane: "claude-code",
      candidateLaneIds: ["claude-code", "antigravity", "local-qwen"],
      runnerFresh: true,
    });
    expect(state.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "AI_EXTERNAL_WORKER",
        requestPayload: expect.objectContaining({
          mode: "AUTO",
          allowWorkspaceWrite: false,
          candidateLaneIds: ["claude-code", "antigravity", "local-qwen"],
        }),
      }),
    );
  });

  it("fails closed when an explicitly requested lane is unavailable", async () => {
    state.runnerFindMany.mockResolvedValue([
      heartbeat({
        codex: {
          health: "unavailable",
          quota: "unknown",
          auth: "not logged in",
        },
      }),
    ]);

    const result = await queueExternalWorker({
      prompt: "Inspect the TypeScript worker contracts and summarize them.",
      capability: "coder",
      preferredLane: "codex",
      mode: "AUTO",
    });

    expect(result).toMatchObject({
      queued: false,
      reason: "no_eligible_worker_lane",
    });
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("rejects obvious PII before a subscription worker can receive it", async () => {
    const result = await queueExternalWorker({
      prompt: "Research this issue and call 216-555-1212 with the result.",
      capability: "deep_reasoner",
      mode: "AUTO",
    });

    expect(result).toMatchObject({ queued: false });
    expect((result as { reason: string }).reason).toContain("pii_not_allowed");
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it("records only hashed prompt evidence in the Reality Ledger", async () => {
    const prompt = "Review the worker queue contract and report only the risks.";
    await queueExternalWorker({
      prompt,
      capability: "coder",
      mode: "AUTO",
    });

    expect(state.recordEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "worker",
        phase: "queued",
        episodeId: "job-1",
        inputHash: expect.stringMatching(/^sha256:/),
      }),
    );
    const episode = state.recordEpisode.mock.calls[0]?.[0];
    expect(JSON.stringify(episode)).not.toContain(prompt);
  });

  it("marks stale worker heartbeats unknown instead of pretending they are healthy", async () => {
    state.runnerFindMany.mockResolvedValue([
      {
        nodeKey: "external-worker:nattynour",
        lastHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000),
        metadata: {
          externalWorker: {
            lanes: {
              codex: {
                health: "ready",
                quota: "available",
                auth: "ChatGPT",
              },
            },
          },
        },
      },
    ]);

    const snapshot = await getExternalWorkerLaneSnapshots();
    expect(snapshot.runnerFresh).toBe(false);
    expect(snapshot.lanes.codex).toMatchObject({
      health: "unknown",
      quota: "unknown",
    });
  });
});
