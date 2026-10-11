/**
 * Resume route · turn identity + operator stop (audit 04-F8 server half,
 * 04-F6 stop marker, 2026-10-10).
 *
 * 04-F8: the in-flight tail and the completed replay of ONE turn answered
 * under two different message ids (a deterministic resume id, then the DB
 * row id), so a re-resume after completion added a second bubble; and a
 * reconnect could not say WHICH turn it wanted, so a lingering record of
 * the previous turn replayed the previous reply.
 *
 * 04-F6: Stop had no server-side marker; a stopped turn persisted as
 * "complete". DELETE on this route records the operator's stop for the
 * in-flight turn (keyed by its traceId) and persist reads it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetActiveStream = vi.fn();
const mockFindFirst = vi.fn();
const mockRequestStop = vi.fn();
const mockRequireSession = vi.fn(async () => ({ ok: true }));

vi.mock("@/lib/auth-guard", () => ({ requireSession: () => mockRequireSession() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { chatMessage: { findFirst: (a: unknown) => mockFindFirst(a) } },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/chat/active-stream", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/chat/active-stream")>(
    "@/lib/services/chat/active-stream",
  );
  return {
    ...actual,
    getActiveStream: (c: string) => mockGetActiveStream(c),
    requestStreamStop: (c: string) => mockRequestStop(c),
  };
});

import { GET, DELETE } from "@/app/api/ai/chat/[conversationId]/stream/route";
import { resumeMessageId } from "@/lib/services/chat/active-stream";

const ctx = (id: string) => ({ params: Promise.resolve({ conversationId: id }) });
const req = (traceId?: string) =>
  ({
    nextUrl: new URL(
      `https://x.test/api/ai/chat/c/stream${traceId ? `?traceId=${encodeURIComponent(traceId)}` : ""}`,
    ),
  }) as never;

async function startMessageId(res: Response): Promise<string | null> {
  const body = await res.text();
  for (const line of body.split("\n")) {
    const t = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!t || t === "[DONE]") continue;
    try {
      const parsed = JSON.parse(t) as { type?: string; messageId?: string };
      if (parsed.type === "start" && parsed.messageId) return parsed.messageId;
    } catch {
      /* non-JSON frame */
    }
  }
  return null;
}

const startedAt = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockResolvedValue({ id: "db-row-1", content: "final reply" });
});

describe("one turn, one message id", () => {
  it("the completed replay answers under the SAME resume id the in-flight tail used", async () => {
    // In-flight read, then complete on the first tail poll.
    mockGetActiveStream
      .mockResolvedValueOnce({ status: "active", traceId: "T1", startedAt, partialText: "final" })
      .mockResolvedValue({ status: "complete", traceId: "T1", startedAt, partialText: "final" });
    const inflightId = await startMessageId(await GET(req(), ctx("conv-1")));

    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T1", startedAt, partialText: "" });
    // The re-resume names its turn (the in-flight response's X-Trace-Id);
    // an unnamed completed replay is a 204 since P2-B6.
    const completedId = await startMessageId(await GET(req("T1"), ctx("conv-1")));

    expect(inflightId).toBe(resumeMessageId("conv-1", "T1"));
    expect(completedId, "a DB-row id here is a second bubble for the same turn").toBe(inflightId);
  });

  it("CONTROL: two different turns get two different resume ids", () => {
    expect(resumeMessageId("conv-1", "T1")).not.toBe(resumeMessageId("conv-1", "T2"));
  });
});

describe("the reconnect names its turn", () => {
  it("a record for a DIFFERENT turn than the one asked for is not replayed (204)", async () => {
    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T-prev", startedAt, partialText: "" });
    const res = await GET(req("T-now"), ctx("conv-1"));
    expect(res.status).toBe(204);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("CONTROL: the matching turn replays (200)", async () => {
    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T-now", startedAt, partialText: "" });
    const res = await GET(req("T-now"), ctx("conv-1"));
    expect(res.status).toBe(200);
  });

  it("no traceId asked for + a completed record -> 204 (P2-B6: a mount's history already shows it)", async () => {
    mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T-prev", startedAt, partialText: "" });
    expect((await GET(req(), ctx("conv-1"))).status).toBe(204);
  });
});

describe("DELETE = operator stop", () => {
  it("records the stop for the in-flight turn and says which turn", async () => {
    mockRequestStop.mockResolvedValue({ stopped: true, traceId: "T1" });
    const res = await DELETE(req(), ctx("conv-1"));
    expect(mockRequireSession).toHaveBeenCalled();
    expect(mockRequestStop).toHaveBeenCalledWith("conv-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: true, traceId: "T1" });
  });

  it("nothing in flight → 409 with the reason, never a fake success", async () => {
    mockRequestStop.mockResolvedValue({ stopped: false, reason: "no_active_turn" });
    const res = await DELETE(req(), ctx("conv-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ stopped: false, reason: "no_active_turn" });
  });

  it("a turn already stored as complete → 409 already_complete (the client says 'stop not recorded')", async () => {
    mockRequestStop.mockResolvedValue({ stopped: false, reason: "already_complete" });
    const res = await DELETE(req(), ctx("conv-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ stopped: false, reason: "already_complete" });
  });

  it("sentinel conversation id never writes", async () => {
    const res = await DELETE(req(), ctx("none"));
    expect(res.status).toBe(409);
    expect(mockRequestStop).not.toHaveBeenCalled();
  });
});
