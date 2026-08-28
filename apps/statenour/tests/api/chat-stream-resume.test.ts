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
vi.mock("@/lib/services/chat/active-stream", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/chat/active-stream")>(
    "@/lib/services/chat/active-stream",
  );
  return { ...actual, getActiveStream: (c: string) => mockGetActiveStream(c) };
});

import { GET } from "@/app/api/ai/chat/[conversationId]/stream/route";

const ctx = (id: string) => ({ params: Promise.resolve({ conversationId: id }) });
const req = () => ({}) as never;

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
    expect(text).toBe(partial);
    expect(text).not.toContain("[unverified claim]");
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

  it("an active turn with NO bytes yet still 204s — an empty bubble is worse than none", async () => {
    mockGetActiveStream.mockResolvedValue({
      status: "active",
      traceId: null,
      startedAt: new Date().toISOString(),
      partialText: "",
    });
    expect((await GET(req(), ctx("conv-1"))).status).toBe(204);
  });
});

describe("resume route · completed turns (V1 behavior preserved)", () => {
  it("replays the PERSISTED message and does not flag partial", async () => {
    mockGetActiveStream.mockResolvedValue({
      status: "complete",
      traceId: null,
      startedAt: new Date().toISOString(),
      partialText: "raw stream text",
    });
    mockFindFirst.mockResolvedValue({ id: "m1", content: "canonical persisted reply" });

    const res = await GET(req(), ctx("conv-1"));

    expect(res.status).toBe(200);
    // The PERSISTED row wins over the raw partial: it carries any
    // fabrication-rewriter banner added pre-persist.
    expect(await readDeltas(res)).toBe("canonical persisted reply");
    expect(res.headers.get("X-Resume-Partial")).toBeNull();
  });

  it("complete but no message row → 204, never a fabricated completion", async () => {
    mockGetActiveStream.mockResolvedValue({
      status: "complete",
      traceId: null,
      startedAt: new Date().toISOString(),
      partialText: "",
    });
    mockFindFirst.mockResolvedValue(null);
    expect((await GET(req(), ctx("conv-1"))).status).toBe(204);
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
