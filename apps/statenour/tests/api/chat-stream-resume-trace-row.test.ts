/**
 * Resume route binds a resumed turn to ITS reply row (review of #2984, P2).
 *
 * A turn that ran action blocks gets a second assistant row from deferred
 * work: "**Action receipts** ... receipts - trace <id>", written after the
 * reply and before the stream record completes. findAssistantMessage picked
 * the newest assistant row after the turn start, so a resume could announce
 * the receipts row as the persisted reply: the client swapped the streamed
 * answer for the receipt text and adopted the wrong DB id. The reply row
 * carries its traceId in tokenUsage; the receipts row has no tokenUsage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; conversationId: string; role: string; content: string; createdAt: Date; tokenUsage: Record<string, unknown> | null };
const rows: Row[] = [];
const mockGetActiveStream = vi.fn();

// In-memory findFirst honouring the where/orderBy the route uses.
function findFirst(args: {
  where: { conversationId: string; role: string; createdAt: { gte: Date }; tokenUsage?: { path: string[]; equals: unknown } };
  orderBy: { createdAt: "desc" | "asc" };
}) {
  const w = args.where;
  const hit = rows
    .filter((r) => r.conversationId === w.conversationId && r.role === w.role && r.createdAt >= w.createdAt.gte)
    .filter((r) => !w.tokenUsage || (r.tokenUsage?.[w.tokenUsage.path[0]] ?? undefined) === w.tokenUsage.equals)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return Promise.resolve(hit ? { id: hit.id, content: hit.content } : null);
}

vi.mock("@/lib/auth-guard", () => ({ requireSession: async () => ({ ok: true }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { chatMessage: { findFirst: (a: never) => findFirst(a) } } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/chat/active-stream", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/chat/active-stream")>("@/lib/services/chat/active-stream");
  return { ...actual, getActiveStream: (c: string) => mockGetActiveStream(c) };
});

import { GET } from "@/app/api/ai/chat/[conversationId]/stream/route";

const ctx = { params: Promise.resolve({ conversationId: "conv-1" }) };
const req = { nextUrl: new URL("https://x.test/api/ai/chat/conv-1/stream?traceId=T1") } as never;
const startedAt = new Date(Date.now() - 60_000);

async function persistedId(res: Response): Promise<string | null> {
  const body = await res.text();
  const m = body.match(/message\.persisted[\s\S]*?"id"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

beforeEach(() => {
  rows.length = 0;
  mockGetActiveStream.mockResolvedValue({ status: "complete", traceId: "T1", startedAt: startedAt.toISOString(), partialText: "the reply" });
});

describe("resume binds to the turn's own reply row", () => {
  it("control: a lone reply row is announced as the persisted reply", async () => {
    rows.push({ id: "reply-1", conversationId: "conv-1", role: "assistant", content: "the reply", createdAt: new Date(startedAt.getTime() + 1000), tokenUsage: { traceId: "T1" } });
    expect(await persistedId(await GET(req, ctx))).toBe("reply-1");
  });

  it("a newer Action receipts row (no tokenUsage) is NOT announced as the reply", async () => {
    rows.push({ id: "reply-1", conversationId: "conv-1", role: "assistant", content: "the reply", createdAt: new Date(startedAt.getTime() + 1000), tokenUsage: { traceId: "T1" } });
    rows.push({ id: "receipts-1", conversationId: "conv-1", role: "assistant", content: "**Action receipts**\n- receipts \u00b7 trace T1", createdAt: new Date(startedAt.getTime() + 2000), tokenUsage: null });
    expect(await persistedId(await GET(req, ctx))).toBe("reply-1");
  });

  it("another turn's newer reply row is not adopted either", async () => {
    rows.push({ id: "reply-1", conversationId: "conv-1", role: "assistant", content: "the reply", createdAt: new Date(startedAt.getTime() + 1000), tokenUsage: { traceId: "T1" } });
    rows.push({ id: "reply-2", conversationId: "conv-1", role: "assistant", content: "next reply", createdAt: new Date(startedAt.getTime() + 3000), tokenUsage: { traceId: "T2" } });
    expect(await persistedId(await GET(req, ctx))).toBe("reply-1");
  });
});
