/**
 * tests/api/chat-stream-resume.test.ts — WP2 (2026-08-28).
 *
 * The behavior under test is the whole point of WP2: an IN-FLIGHT turn
 * must replay the bytes it has produced so far. V1 returned 204 for
 * anything not `status === "complete"`, which meant the measured
 * 132s-mean deep turns — the exact "complex tasks" the operator reports
 * as broken — destroyed their partial work on every disconnect.
 *
 * These drive the REAL route handler (not a reimplementation of its
 * logic) against a mocked registry + prisma, and read the emitted SSE
 * body, so a regression in the route itself is caught rather than a
 * regression in a test-local copy of its rules.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetActiveStream = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@/lib/auth-guard", () => ({ requireSession: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { chatMessage: { findFirst: (a: unknown) => mockFindFirst(a) } },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
const mockFindUserTurnRow = vi.fn();
vi.mock("@/lib/services/chat/user-turn-identity", () => ({
  findUserTurnRow: (a: unknown) => mockFindUserTurnRow(a),
}));
vi.mock("@/lib/services/chat/active-stream", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/chat/active-stream")>(
    "@/lib/services/chat/active-stream",
  );
  return { ...actual, getActiveStream: (c: string) => mockGetActiveStream(c) };
});

import { GET } from "@/app/api/ai/chat/[conversationId]/stream/route";

const ctx = (id: string) => ({ params: Promise.resolve({ conversationId: id }) });
const req = () => ({}) as never;
/** A resume that names its turn (P2-B6: an unnamed completed replay is a 204). */
const namedReq = (traceId: string) =>
  ({ nextUrl: new URL(`https://x.test/api/ai/chat/c/stream?traceId=${traceId}`) }) as never;

/** Concatenate the text-delta payloads out of the SSE body. */
async function readDeltas(res: Response): Promise<string> {
  const body = await res.text();
  let out = "";
  for (const line of body.split("\n")) {
    const t = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!t || t === "[DONE]") continue;
    try {
      const parsed = JSON.parse(t) as { type?: string; delta?: string };
      if (parsed.type === "text-delta" && typeof parsed.delta === "string") out += parsed.delta;
    } catch {
      /* non-JSON frame — ignore */
    }
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockResolvedValue(null);
});

describe("resume route · in-flight turns (the WP2 defect)", () => {
  it("replays partial bytes of a STILL-GENERATING turn instead of 204, then tails to completion", async () => {
    const startedAt = new Date().toISOString();
    const partial = "the operator asked about revenue and I have started";
    // First read: mid-generation. Second: the turn finished while the
    // client was tailing — the route must append the remainder rather
    // than restart or duplicate.
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: null, startedAt, partialText: partial })
      .mockResolvedValue({ status: "complete", traceId: null, startedAt, partialText: partial });
    mockFindFirst.mockResolvedValue({ id: "m1", content: partial + " — and here is the rest." });

    const res = await GET(req(), ctx("conv-1"));

    expect(res.status).toBe(200);
    const text = await readDeltas(res);
    // The bytes that V1 threw away:
    expect(text).toContain("the operator asked about revenue");
    // Continuation, emitted exactly once — no duplicated prefix.
    expect(text).toBe(partial + " — and here is the rest.");
  });

  it("does NOT splice when the persisted row diverged from the streamed partial", async () => {
    const startedAt = new Date().toISOString();
    const partial = "I created both profiles";
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: null, startedAt, partialText: partial })
      .mockResolvedValue({ status: "complete", traceId: null, startedAt, partialText: partial });
    // L2 fabrication-rewriter prepends a banner pre-persist, so the
    // canonical row is NOT a continuation of what the client holds.
    mockFindFirst.mockResolvedValue({
      id: "m1",
      content: "[unverified claim] I created both profiles",
    });

    const text = await readDeltas(await GET(req(), ctx("conv-1")));
    // Emits what the client already saw and stops — never a hybrid of
    // two different strings.
    expect(text).toContain(partial);
    expect(text).not.toContain("[unverified claim]");
    // And says so honestly: the turn FINISHED (it did not run out of
    // window), so the marker must not claim it is still generating.
    expect(text).toContain("reload to see the final version");
    expect(text).not.toContain("still generating");
  });

  it("flags a partial resume in the response headers — never silent degradation", async () => {
    mockGetActiveStream.mockResolvedValue({
      status: "active",
      traceId: null,
      startedAt: new Date().toISOString(),
      partialText: "half a thought",
    });

    const res = await GET(req(), ctx("conv-1"));
    expect(res.headers.get("X-Resume-Partial")).toBe("1");
  });

  it("a force-closed tail emits a VISIBLE marker — a truncated reply must not render as a finished one", async () => {
    // The review finding this pins: closing the tail emits a real
    // `finish` chunk, the AI SDK has no "partial" status, so it sets
    // `ready`, isStreaming flips false, and stall detection tears down.
    // A header alone is invisible if any reader is missing. Bytes in the
    // bubble cannot be dropped.
    const startedAt = new Date().toISOString();
    mockGetActiveStream.mockResolvedValue({
      status: "active",
      traceId: null,
      startedAt,
      partialText: "I am partway through the analysis",
    });

    const res = await GET(req(), ctx("conv-1"));
    const text = await readDeltas(res);

    expect(text).toContain("I am partway through the analysis");
    expect(text).toContain("still generating");
    // Both signals present — the header drives auto-re-resume, the marker
    // survives a missing reader.
    expect(res.headers.get("X-Resume-Partial")).toBe("1");
  }, 30_000);

  // 2026-10-25: a buffered lane writes no partial bytes, so "no bytes yet" covered a turn that
  // was still working for minutes. The route now waits its window before answering.
  it("an active turn with NO bytes for the whole window 204s with X-Resume-Pending (never an empty bubble)", async () => {
    vi.useFakeTimers();
    try {
      mockGetActiveStream.mockResolvedValue({
        status: "active",
        traceId: "T2",
        startedAt: new Date().toISOString(),
        partialText: "",
      });
      const pending = GET(req(), ctx("conv-1"));
      await vi.advanceTimersByTimeAsync(21_000);
      const res = await pending;
      expect(res.status).toBe(204);
      expect(res.headers.get("X-Resume-Pending"), "the client must learn the turn is alive").toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a turn with no bytes yet that saves inside the window replays its saved reply, unnamed", async () => {
    const startedAt = new Date().toISOString();
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: "T2", startedAt, partialText: "" })
      .mockResolvedValue({ status: "complete", traceId: "T2", startedAt, partialText: "" });
    mockFindFirst.mockResolvedValue({ id: "m2", content: "the buffered reply, saved whole" });

    const res = await GET(req(), ctx("conv-1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Trace-Id")).toBe("T2");
    expect(res.headers.get("X-Resume-Partial")).toBeNull();
    expect(await readDeltas(res)).toBe("the buffered reply, saved whole");
  });

  it("CONTROL: the row goes to another turn mid-wait: plain 204, not pending, no replay", async () => {
    const startedAt = new Date().toISOString();
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: "T2", startedAt, partialText: "" })
      .mockResolvedValue({ status: "complete", traceId: "T3", startedAt, partialText: "" });
    mockFindFirst.mockResolvedValue({ id: "m3", content: "another turn's reply" });

    const res = await GET(req(), ctx("conv-1"));

    expect(res.status).toBe(204);
    expect(res.headers.get("X-Resume-Pending")).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

// Round 2 review, S1: the pending 204 named nothing, so the client's next GET was unnamed and a
// reply that saved in between hit the P2-B6 "unnamed completed = 204" rule: stuck, reply hidden.
describe("resume route · a pending answer names its turn", () => {
  it("the pending 204 carries the turn's trace and conversation, and the named GET after the save replays it", async () => {
    vi.useFakeTimers();
    const startedAt = new Date().toISOString();
    try {
      mockGetActiveStream.mockResolvedValue({ status: "active", traceId: "T2", startedAt, partialText: "" });
      const pending = GET(req(), ctx("conv-1"));
      await vi.advanceTimersByTimeAsync(21_000);
      const first = await pending;
      expect(first.status).toBe(204);
      expect(first.headers.get("X-Trace-Id"), "the next GET must be able to name the turn").toBe("T2");
      // Only a first send learns its conversation here; a known one must not be re-announced
      // (a late answer would pull the operator back from a thread they switched to).
      expect(first.headers.get("X-Conversation-Id")).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T2", startedAt, partialText: "" });
    mockFindFirst.mockResolvedValue({ id: "m2", content: "saved between the two asks" });
    const second = await GET(namedReq("T2"), ctx("conv-1"));
    expect(second.status).toBe(200);
    expect(await readDeltas(second)).toBe("saved between the two asks");
  });
});

// Round 2 review, S2 (Nour's 2026-10-25 turn was the FIRST message of a new chat): the client has no
// conversation id until the POST's headers, and a buffered lane sends none until its reply is whole.
// The user row is written before generation and carries the id the client minted, so the resume
// can find the conversation by it (findUserTurnRow's first-send rule).
describe("resume route · a first send found by the client's message id", () => {
  const userRow = (createdAt: Date) => ({ id: "row-u1", conversationId: "conv-new", clientMessageId: "u1", createdAt });
  const firstSendReq = (extra = "") =>
    ({ nextUrl: new URL(`https://x.test/api/ai/chat/none/stream?clientMessageId=u1${extra}`) }) as never;

  it("replays the saved reply of the turn that message started, and hands back the conversation id", async () => {
    const sentAt = new Date(Date.now() - 200_000);
    const startedAt = new Date(sentAt.getTime() + 3_000).toISOString();
    mockFindUserTurnRow.mockResolvedValue(userRow(sentAt));
    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T2", startedAt, partialText: "", clientMessageId: "u1" });
    mockFindFirst.mockResolvedValue({ id: "m2", content: "the first reply in the new chat" });

    const res = await GET(firstSendReq(), ctx("none"));

    expect(mockFindUserTurnRow).toHaveBeenCalledWith({ conversationId: null, messageId: "u1" });
    expect(mockGetActiveStream).toHaveBeenCalledWith("conv-new");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Conversation-Id"), "later sends must join this conversation").toBe("conv-new");
    expect(await readDeltas(res)).toBe("the first reply in the new chat");
  });

  it("CONTROL: a completed record OLDER than the message is not its reply", async () => {
    const sentAt = new Date();
    mockFindUserTurnRow.mockResolvedValue(userRow(sentAt));
    mockGetActiveStream.mockResolvedValue({
      status: "complete",
      traceId: "T0",
      startedAt: new Date(sentAt.getTime() - 60_000).toISOString(),
      partialText: "",
    });
    mockFindFirst.mockResolvedValue({ id: "m0", content: "an older reply" });

    expect((await GET(firstSendReq(), ctx("none"))).status).toBe(204);
  });

  // Round 4 (Codex P2): every LATER turn in the conversation also started after the first message,
  // so a timestamp cannot say whose row it is. The row names the user message it was registered for.
  it("a LATER turn's row (registered for another message) never replays into the first send", async () => {
    const sentAt = new Date(Date.now() - 300_000);
    mockFindUserTurnRow.mockResolvedValue(userRow(sentAt));
    mockGetActiveStream.mockResolvedValue({
      status: "complete",
      traceId: "T5",
      startedAt: new Date(sentAt.getTime() + 120_000).toISOString(),
      partialText: "",
      clientMessageId: "u5",
    });
    mockFindFirst.mockResolvedValue({ id: "m5", content: "the fifth turn's reply" });

    const res = await GET(firstSendReq(), ctx("none"));
    expect(res.status).toBe(204);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("CONTROL: no message id, or one with no saved row (private, or never landed): 204, no registry read", async () => {
    mockFindUserTurnRow.mockResolvedValue(null);
    expect((await GET(req(), ctx("none"))).status).toBe(204);
    expect((await GET(firstSendReq(), ctx("none"))).status).toBe(204);
    expect(mockGetActiveStream).not.toHaveBeenCalled();
  });
});

describe("resume route · completed turns (V1 behavior preserved)", () => {
  it("replays the PERSISTED message and does not flag partial", async () => {
    mockGetActiveStream.mockResolvedValue({
      status: "complete",
      traceId: "T1",
      startedAt: new Date().toISOString(),
      partialText: "raw stream text",
    });
    mockFindFirst.mockResolvedValue({ id: "m1", content: "canonical persisted reply" });

    const res = await GET(namedReq("T1"), ctx("conv-1"));

    expect(res.status).toBe(200);
    // The PERSISTED row wins over the raw partial: it carries any
    // fabrication-rewriter banner added pre-persist.
    expect(await readDeltas(res)).toBe("canonical persisted reply");
    expect(res.headers.get("X-Resume-Partial")).toBeNull();
  });

  it("complete but no message row → 204, never a fabricated completion", async () => {
    mockGetActiveStream.mockResolvedValue({
      status: "complete",
      traceId: "T1",
      startedAt: new Date().toISOString(),
      partialText: "",
    });
    mockFindFirst.mockResolvedValue(null);
    expect((await GET(namedReq("T1"), ctx("conv-1"))).status).toBe(204);
    expect(mockFindFirst).toHaveBeenCalled();
  });
});

describe("resume route · guards that must not regress", () => {
  it("no record → 204", async () => {
    mockGetActiveStream.mockResolvedValue(null);
    expect((await GET(req(), ctx("conv-1"))).status).toBe(204);
  });

  it("sentinel conversation id short-circuits before any DB read", async () => {
    expect((await GET(req(), ctx("none"))).status).toBe(204);
    expect(mockGetActiveStream).not.toHaveBeenCalled();
  });
});
