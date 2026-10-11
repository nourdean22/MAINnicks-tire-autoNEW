/**
 * Resume route · which turn a resume answers for, and the DB id it binds
 * (task P2-B6, follow-up to audit 04-F2 / 04-F8, 2026-10-10).
 *
 *   1. A resume that names no turn (`useChat({ resume: true })` on mount,
 *      e.g. an SPA return to /chat inside the 3 min linger) used to replay
 *      the previous COMPLETED reply as a new message, beside the copy the
 *      history load already shows. It now gets 204. An in-flight turn still
 *      replays: the history has no row for it yet.
 *   2. A resumed turn whose row exists now sends `event: message.persisted`
 *      (the DB id + stored text), the same frame the live POST stream sends,
 *      so the client binds the bubble instead of keeping `resume-...`.
 *   3. Every resume response carries `X-Trace-Id`, so a mount-time resume
 *      learns its turn and the automatic re-resume can name it (without
 *      that, rule 1 would 204 the re-resume of a turn that just finished).
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
const req = (traceId?: string) =>
  ({
    nextUrl: new URL(
      `https://x.test/api/ai/chat/c/stream${traceId ? `?traceId=${encodeURIComponent(traceId)}` : ""}`,
    ),
  }) as never;

/** The payload of the `event: message.persisted` frame, or null. */
function persistedFrame(body: string): unknown {
  const frames = body.split("\n\n");
  for (const frame of frames) {
    const lines = frame.split("\n");
    if (lines[0] !== "event: message.persisted") continue;
    const data = lines.find((l) => l.startsWith("data:"));
    return data ? JSON.parse(data.slice(5).trim()) : null;
  }
  return null;
}

const startedAt = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockResolvedValue({ id: "db-row-1", content: "final reply" });
});

describe("a resume that names no turn never replays a finished reply", () => {
  it("no traceId + completed record -> 204, and the stored row is never read", async () => {
    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T-prev", startedAt, partialText: "" });
    const res = await GET(req(), ctx("conv-1"));
    expect(res.status).toBe(204);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("CONTROL: the same completed record replays when the client names that turn", async () => {
    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T1", startedAt, partialText: "" });
    expect((await GET(req("T1"), ctx("conv-1"))).status).toBe(200);
  });

  it("CONTROL: an in-flight turn still replays on mount (the history has no row for it yet)", async () => {
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: "T1", startedAt, partialText: "half" })
      .mockResolvedValue({ status: "complete", traceId: "T1", startedAt, partialText: "half" });
    mockFindFirst.mockResolvedValue({ id: "db-row-1", content: "half and the rest" });
    expect((await GET(req(), ctx("conv-1"))).status).toBe(200);
  });
});

describe("a resumed turn binds its DB row", () => {
  it("the completed replay sends message.persisted with the row id and stored text", async () => {
    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T1", startedAt, partialText: "" });
    const res = await GET(req("T1"), ctx("conv-1"));
    expect(persistedFrame(await res.text())).toEqual({ id: "db-row-1", content: "final reply" });
  });

  it("a tail that sees the turn finish sends message.persisted too", async () => {
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: "T1", startedAt, partialText: "final" })
      .mockResolvedValue({ status: "complete", traceId: "T1", startedAt, partialText: "final" });
    const res = await GET(req("T1"), ctx("conv-1"));
    expect(persistedFrame(await res.text())).toEqual({ id: "db-row-1", content: "final reply" });
  });

  it("a tail whose stored row diverged still binds: the stored text replaces the unsafe splice", async () => {
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: "T1", startedAt, partialText: "I created both" })
      .mockResolvedValue({ status: "complete", traceId: "T1", startedAt, partialText: "I created both" });
    mockFindFirst.mockResolvedValue({ id: "db-row-1", content: "[unverified claim] I created both" });
    const res = await GET(req("T1"), ctx("conv-1"));
    expect(persistedFrame(await res.text())).toEqual({ id: "db-row-1", content: "[unverified claim] I created both" });
  });

  it("CONTROL: a tail that never saw a stored row sends no message.persisted", async () => {
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: "T1", startedAt, partialText: "half" })
      .mockResolvedValue(null);
    const res = await GET(req("T1"), ctx("conv-1"));
    const body = await res.text();
    expect(body).toContain("half");
    expect(persistedFrame(body)).toBeNull();
  });
});

describe("every resume names its turn in X-Trace-Id", () => {
  it("the completed replay", async () => {
    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T1", startedAt, partialText: "" });
    expect((await GET(req("T1"), ctx("conv-1"))).headers.get("X-Trace-Id")).toBe("T1");
  });

  it("an unnamed mount-time tail, so its automatic re-resume can name the turn", async () => {
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: "T1", startedAt, partialText: "half" })
      .mockResolvedValue(null);
    const res = await GET(req(), ctx("conv-1"));
    expect(res.headers.get("X-Trace-Id")).toBe("T1");
    expect(res.headers.get("X-Resume-Partial")).toBe("1");
  });
});
