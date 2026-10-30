/**
 * Brain backfill W1 (2026-10-30). The session distiller only looked at chats touched in the
 * last 30 days and never at archived ones, so after the cron's 05-28..08-06 outage 107 chats
 * (May 5 - Jul 13) could never be distilled. The queue now reaches any age, recent chats first,
 * and an old chat's distill stays out of the rolling "current concerns" block.
 *
 * Review round 1 (PR 3379): a soft-deleted chat_summary looked "missing" to the queue, and
 * remember() rewrote the tombstone without reviving it, so the same oldest chats were picked
 * every night; a chat the model can never parse did the same. Any chat_summary row now counts,
 * and two failed attempts park a chat.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const DAY = 86_400_000;

type Convo = { id: string; updatedAt: Date; archivedAt: Date | null; messages: number };
type Mem = { category: string; key: string; updatedAt: Date; deletedAt: Date | null; seenCount: number };

const h = vi.hoisted(() => {
  const state = {
    convos: [] as Array<{ id: string; updatedAt: Date; archivedAt: Date | null; messages: number }>,
    mems: [] as Array<{ category: string; key: string; updatedAt: Date; deletedAt: Date | null; seenCount: number }>,
    messages: [] as Array<{ role: string; content: string; createdAt: Date }>,
  };
  // Honours the where-shapes the distiller uses (and the old ones), so the test exercises the query, not a canned list.
  const convoFindMany = vi.fn(async (args: {
    where?: { archivedAt?: null; updatedAt?: { lt?: Date; gt?: Date } };
    orderBy?: { updatedAt: "asc" | "desc" };
    take?: number;
  }) => {
    const w = args.where ?? {};
    let rows = state.convos.filter((c) => {
      if ("archivedAt" in w && w.archivedAt === null && c.archivedAt !== null) return false;
      if (w.updatedAt?.lt && !(c.updatedAt < w.updatedAt.lt)) return false;
      if (w.updatedAt?.gt && !(c.updatedAt > w.updatedAt.gt)) return false;
      return true;
    });
    rows = rows.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    if (args.orderBy?.updatedAt === "desc") rows.reverse();
    if (typeof args.take === "number") rows = rows.slice(0, args.take);
    return rows.map((c) => ({ id: c.id, updatedAt: c.updatedAt, archivedAt: c.archivedAt, _count: { messages: c.messages } }));
  });
  const memFindMany = vi.fn(async ({ where }: { where: { category?: string | { in: string[] }; key: { in: string[] }; deletedAt?: null } }) =>
    state.mems.filter((m) => {
      const cats = typeof where.category === "string" ? [where.category] : where.category?.in;
      if (cats && !cats.includes(m.category)) return false;
      if (!where.key.in.includes(m.key)) return false;
      if ("deletedAt" in where && where.deletedAt === null && m.deletedAt !== null) return false;
      return true;
    }),
  );
  const prisma = {
    chatConversation: {
      findMany: convoFindMany,
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, title: null, messages: state.messages })),
    },
    brainMemory: { findMany: memFindMany, findUnique: vi.fn(async () => null) },
  };
  const admitMemory = vi.fn(async (input: { category: string }) => ({ id: `mem-${input.category}`, evidenceClass: "x", memoryKind: "derived" }));
  const remember = vi.fn(async () => ({ id: "attempt" }));
  const good = JSON.stringify({ summary: "s", decisions: [], commitments: [], questions_still_open: ["q"], emotional_tone: "steady", next_follow_up: null });
  const aiChat = vi.fn(async () => ({ provider: "ollama", content: good }));
  return { state, prisma, admitMemory, remember, aiChat, good };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/brain/memory-admission", () => ({ admitMemory: h.admitMemory }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: h.remember } }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));

import { distillConversation, distillIdleSessions, findEligibleConversations } from "@/lib/brain/session-distiller";

const ago = (ms: number) => new Date(Date.now() - ms);
const convo = (id: string, ageMs: number, extra: Partial<Convo> = {}): Convo => ({ id, updatedAt: ago(ageMs), archivedAt: null, messages: 6, ...extra });
const summary = (key: string, ageMs: number, extra: Partial<Mem> = {}): Mem => ({ category: "chat_summary", key, updatedAt: ago(ageMs), deletedAt: null, seenCount: 1, ...extra });
/** One distill_attempt row per failed attempt, keyed `<conversationId>:<n>` (remember() cannot count: a repeat is a gateway noop). */
const attempt = (convId: string, n: number, deletedAt: Date | null = null): Mem => ({ category: "distill_attempt", key: `${convId}:${n}`, updatedAt: ago(DAY), deletedAt, seenCount: 1 });

beforeEach(() => {
  h.state.convos = [];
  h.state.mems = [];
  h.state.messages = [];
  vi.clearAllMocks();
  h.aiChat.mockImplementation(async () => ({ provider: "ollama", content: h.good }));
});

describe("findEligibleConversations · reaches every undistilled chat", () => {
  it("picks a chat idle 60 days that was never distilled", async () => {
    h.state.convos = [convo("old", 60 * DAY)];
    expect(await findEligibleConversations(10)).toEqual(["old"]);
  });

  it("picks an archived chat that was never distilled", async () => {
    h.state.convos = [convo("arch", 90 * DAY, { archivedAt: ago(80 * DAY) })];
    expect(await findEligibleConversations(10)).toEqual(["arch"]);
  });

  it("leaves an archived chat alone once it has a live distill", async () => {
    h.state.convos = [convo("arch", 90 * DAY, { archivedAt: ago(80 * DAY) })];
    h.state.mems = [summary("arch", 85 * DAY)];
    expect(await findEligibleConversations(10)).toEqual([]);
  });

  it("still re-distills a live chat that continued after its distill, and skips a fresh one", async () => {
    h.state.convos = [convo("continued", 2 * DAY), convo("fresh", 3 * DAY)];
    h.state.mems = [summary("continued", 5 * DAY), summary("fresh", 1 * DAY)];
    expect(await findEligibleConversations(10)).toEqual(["continued"]);
  });

  it("does not redistill a backlog chat that already has a live distill, even if it was touched after it", async () => {
    h.state.convos = [convo("touched", 60 * DAY)];
    h.state.mems = [summary("touched", 90 * DAY)];
    expect(await findEligibleConversations(10)).toEqual([]);
  });

  it("a soft-deleted distill is a tombstone, not a gap: neither a backlog nor a recent chat is picked again", async () => {
    h.state.convos = [convo("old-tomb", 60 * DAY), convo("recent-tomb", 2 * DAY), convo("never", 70 * DAY)];
    h.state.mems = [summary("old-tomb", 50 * DAY, { deletedAt: ago(40 * DAY) }), summary("recent-tomb", 3 * DAY, { deletedAt: ago(1 * DAY) })];
    expect(await findEligibleConversations(10)).toEqual(["never"]);
  });

  it("a chat with two failed attempts is parked; one failure still gets a retry", async () => {
    h.state.convos = [convo("failed-twice", 60 * DAY), convo("failed-once", 55 * DAY), convo("next", 50 * DAY)];
    // The second marker parks the chat even after the nightly prune soft-deletes it.
    h.state.mems = [attempt("failed-twice", 1, ago(DAY)), attempt("failed-twice", 2, ago(DAY)), attempt("failed-once", 1)];
    expect(await findEligibleConversations(10)).toEqual(["failed-once", "next"]);
  });

  it.each([
    [29, ["boundary"]],
    [31, []],
  ])("the 30-day recent boundary: a chat active %s days ago, after its live distill, is redistilled -> %j", async (days, expected) => {
    h.state.convos = [convo("boundary", days * DAY)];
    h.state.mems = [summary("boundary", (days + 5) * DAY)];
    expect(await findEligibleConversations(10)).toEqual(expected);
  });

  it("serves recent chats before the backlog, oldest first within each, and keeps the batch cap", async () => {
    h.state.convos = [convo("old-a", 120 * DAY), convo("recent-b", 2 * DAY), convo("old-b", 90 * DAY), convo("recent-a", 5 * DAY)];
    expect(await findEligibleConversations(3)).toEqual(["recent-a", "recent-b", "old-a"]);
  });

  it("skips chats with fewer than 4 messages and chats active in the last 30 minutes", async () => {
    h.state.convos = [convo("short", 40 * DAY, { messages: 3 }), convo("live", 10 * 60_000)];
    expect(await findEligibleConversations(10)).toEqual([]);
  });
});

describe("distillConversation · an old chat stays out of current concerns", () => {
  const msgs = (lastAgoMs: number) =>
    [3, 2, 1, 0].map((i) => ({ role: i % 2 ? "user" : "assistant", content: `m${i}`, createdAt: ago(lastAgoMs + i * 60_000) }));
  const concernWrites = () => h.admitMemory.mock.calls.filter(([a]) => (a as { category: string }).category === "nick_current_concerns");
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it.each([
    [1, 1],
    [13, 1],
    [15, 0],
    [60, 0],
  ])("a chat whose last message is %s days old writes %s concerns update(s)", async (days, n) => {
    h.state.messages = msgs(days * DAY);
    expect(await distillConversation(`c${days}`)).not.toBeNull();
    await settle();
    expect(h.admitMemory.mock.calls.some(([a]) => (a as { category: string }).category === "chat_summary")).toBe(true);
    expect(concernWrites()).toHaveLength(n);
  });

  it("the summary is dated at the chat's last message, not today", async () => {
    h.state.messages = msgs(60 * DAY);
    await distillConversation("old");
    const summaryCall = h.admitMemory.mock.calls.find(([a]) => (a as { category: string }).category === "chat_summary")![0] as { effectiveFrom: Date; source: string; evidenceRefs: string[] };
    expect(Date.now() - summaryCall.effectiveFrom.getTime()).toBeGreaterThan(59 * DAY);
    expect(summaryCall.source).toBe("session_distiller");
    expect(summaryCall.evidenceRefs).toEqual(["conversation:old"]);
  });

  it("an unparseable model reply writes no summary and records attempt 1 for that chat", async () => {
    h.state.messages = msgs(60 * DAY);
    h.aiChat.mockImplementation(async () => ({ provider: "ollama", content: "I'm having trouble connecting right now." }));
    expect(await distillConversation("bad")).toBeNull();
    expect(h.admitMemory).not.toHaveBeenCalled();
    expect(h.remember).toHaveBeenCalledTimes(1);
    expect(h.remember.mock.calls[0]).toEqual(["distill_attempt", "bad:1", expect.any(String), "session_distiller"]);
  });

  it("a second failure records attempt 2, which parks the chat", async () => {
    h.state.messages = msgs(60 * DAY);
    h.state.mems = [attempt("bad", 1, ago(DAY))];
    h.aiChat.mockImplementation(async () => ({ provider: "ollama", content: "not json" }));
    expect(await distillConversation("bad")).toBeNull();
    expect(h.remember.mock.calls[0][1]).toBe("bad:2");
  });

  it.each(["none", "emergency"])("a provider outage (%s sentinel) writes nothing and counts no attempt: it is retried tomorrow", async (provider) => {
    h.state.messages = msgs(60 * DAY);
    h.aiChat.mockImplementation(async () => ({ provider, content: "I'm having trouble connecting right now." }));
    expect(await distillConversation("outage")).toBeNull();
    expect(h.admitMemory).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("a successful distill records no attempt", async () => {
    h.state.messages = msgs(60 * DAY);
    await distillConversation("ok");
    expect(h.remember).not.toHaveBeenCalled();
  });
});

describe("distillIdleSessions · an outage reads as failures, not skips", () => {
  it("a run where the provider is down reports failures, not skipped", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      h.state.convos = [convo("a", 60 * DAY), convo("b", 50 * DAY)];
      h.state.messages = [3, 2, 1, 0].map((i) => ({ role: i % 2 ? "user" : "assistant", content: `m${i}`, createdAt: ago(60 * DAY + i * 60_000) }));
      h.aiChat.mockImplementation(async () => ({ provider: "none", content: "I'm having trouble connecting." }));
      const run = distillIdleSessions(10);
      await vi.runAllTimersAsync();
      expect(await run).toEqual({ eligible: 2, distilled: 0, skipped: 0, failures: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});
