/**
 * Operator stop marker in the active-stream registry (audit 04-F6, 2026-10-10).
 *
 * The stop is recorded on its OWN row keyed by (conversation, traceId):
 *   · a stop for turn T1 can never mark a later turn T2;
 *   · it never shares a read-modify-write with the partial flusher, so a
 *     racing partial flush cannot erase it;
 *   · a finished (or absent) turn is not stoppable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows = new Map<string, Record<string, unknown>>();
const mockUpsert = vi.fn(async (a: { where: { category_key: { key: string } }; create: Record<string, unknown> }) => {
  rows.set(a.where.category_key.key, { ...a.create, deletedAt: null });
  return {};
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      upsert: (a: never) => mockUpsert(a),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async (a: { where: { category_key: { key: string } } }) =>
        rows.get(a.where.category_key.key) ?? null,
      ),
    },
  },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { requestStreamStop, isStreamStopRequested } from "@/lib/services/chat/active-stream";

function seedTurn(status: "active" | "complete", traceId: string | null) {
  rows.set("stream:c1", {
    metadata: { status, traceId, startedAt: new Date().toISOString() },
    expiresAt: new Date(Date.now() + 60_000),
    deletedAt: null,
  });
}

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
});

describe("requestStreamStop", () => {
  it("marks the in-flight turn, keyed by its traceId", async () => {
    seedTurn("active", "T1");
    expect(await requestStreamStop("c1")).toEqual({ stopped: true, traceId: "T1" });
    expect(await isStreamStopRequested("c1", "T1")).toBe(true);
  });

  it("CONTROL: before any stop, the turn is not marked", async () => {
    seedTurn("active", "T1");
    expect(await isStreamStopRequested("c1", "T1")).toBe(false);
  });

  it("a stop for T1 never marks the next turn T2", async () => {
    seedTurn("active", "T1");
    await requestStreamStop("c1");
    seedTurn("active", "T2");
    expect(await isStreamStopRequested("c1", "T2")).toBe(false);
  });

  it("a finished turn, an absent turn, or a turn with no traceId is not stoppable", async () => {
    seedTurn("complete", "T1");
    expect(await requestStreamStop("c1")).toEqual({ stopped: false, reason: "no_active_turn" });
    rows.clear();
    expect(await requestStreamStop("c1")).toEqual({ stopped: false, reason: "no_active_turn" });
    seedTurn("active", null);
    expect(await requestStreamStop("c1")).toEqual({ stopped: false, reason: "no_active_turn" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("an expired stop row reads as no stop", async () => {
    rows.set("stop:c1:T1", { expiresAt: new Date(Date.now() - 1), deletedAt: null });
    expect(await isStreamStopRequested("c1", "T1")).toBe(false);
  });
});
