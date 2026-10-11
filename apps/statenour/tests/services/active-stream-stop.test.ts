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
/** Persisted assistant rows: what persist-assistant-message wrote per turn. */
const messages: Array<{ conversationId: string; traceId: string; streamingState: string }> = [];
/** Set by the race test: runs once, between requestStreamStop's two ops. */
let between: (() => Promise<void>) | null = null;
async function runBetween() {
  const fn = between;
  between = null;
  if (fn) await fn();
}
const mockUpsert = vi.fn(async (a: { where: { category_key: { key: string } }; create: Record<string, unknown> }) => {
  rows.set(a.where.category_key.key, { ...a.create, deletedAt: null });
  await runBetween();
  return {};
});
const mockMessageFindFirst = vi.fn(
  async (a: { where: { conversationId: string; role: string; tokenUsage: { path: string[]; equals: string } } }) => {
    const hit = messages.findLast(
      (m) => m.conversationId === a.where.conversationId && m.traceId === a.where.tokenUsage.equals,
    );
    await runBetween();
    return hit ? { streamingState: hit.streamingState } : null;
  },
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      upsert: (a: never) => mockUpsert(a),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async (a: { where: { category_key: { key: string } } }) =>
        rows.get(a.where.category_key.key) ?? null,
      ),
    },
    chatMessage: { findFirst: (a: never) => mockMessageFindFirst(a) },
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
  messages.length = 0;
  between = null;
  vi.clearAllMocks();
});

/** persist-assistant-message's order: read the stop marker, then create the row. */
async function simulatePersist(traceId: string) {
  const stopped = await isStreamStopRequested("c1", traceId);
  messages.push({ conversationId: "c1", traceId, streamingState: stopped ? "aborted" : "complete" });
}

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

  // The stream record stays "active" until the whole onFinish chain resolves
  // (post-persist verification, deferred work: up to ~15 s), long after the
  // row was written. A Stop there marked nothing; it must not answer success.
  it("a turn whose row is already stored as complete -> already_complete, not stopped", async () => {
    seedTurn("active", "T1");
    messages.push({ conversationId: "c1", traceId: "T1", streamingState: "complete" });
    expect(await requestStreamStop("c1")).toEqual({ stopped: false, reason: "already_complete" });
  });

  it("CONTROL: a row stored as aborted (persist saw the stop) is a recorded stop", async () => {
    seedTurn("active", "T1");
    messages.push({ conversationId: "c1", traceId: "T1", streamingState: "aborted" });
    expect(await requestStreamStop("c1")).toEqual({ stopped: true, traceId: "T1" });
  });

  it("CONTROL: the PREVIOUS turn's complete row does not block stopping this turn", async () => {
    messages.push({ conversationId: "c1", traceId: "T0", streamingState: "complete" });
    seedTurn("active", "T1");
    expect(await requestStreamStop("c1")).toEqual({ stopped: true, traceId: "T1" });
  });

  // Persist reads the marker, then creates the row. Stop must write the
  // marker, then read the row: a persist landing between Stop's two ops then
  // sees the marker (row aborted) and Stop sees that row. Read-first would
  // see no row, let persist store "complete", and still answer stopped.
  it("a persist that lands between Stop's two ops: the reply agrees with the stored row", async () => {
    seedTurn("active", "T1");
    between = () => simulatePersist("T1");
    const result = await requestStreamStop("c1");
    const stored = messages.find((m) => m.traceId === "T1")!.streamingState;
    expect(stored).toBe("aborted");
    expect(result).toEqual({ stopped: true, traceId: "T1" });
  });

  it("a failed row read is not a confirmed stop", async () => {
    seedTurn("active", "T1");
    mockMessageFindFirst.mockRejectedValueOnce(new Error("db down"));
    expect(await requestStreamStop("c1")).toMatchObject({ stopped: false });
  });

  it("an expired stop row reads as no stop", async () => {
    rows.set("stop:c1:T1", { expiresAt: new Date(Date.now() - 1), deletedAt: null });
    expect(await isStreamStopRequested("c1", "T1")).toBe(false);
  });
});
