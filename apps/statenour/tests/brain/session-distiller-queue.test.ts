/**
 * Brain backfill W1 (2026-10-30). The session distiller only looked at chats touched in the
 * last 30 days and never at archived ones, so after the cron's 05-28..08-06 outage 107 chats
 * (May 5 - Jul 13) could never be distilled. The queue now reaches any age, recent chats first,
 * and an old chat's distill stays out of the rolling "current concerns" block.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const DAY = 86_400_000;

type Convo = { id: string; updatedAt: Date; archivedAt: Date | null; messages: number };

const h = vi.hoisted(() => {
  const state = {
    convos: [] as Array<{ id: string; updatedAt: Date; archivedAt: Date | null; messages: number }>,
    distills: new Map<string, Date>(),
    messages: [] as Array<{ role: string; content: string; createdAt: Date }>,
  };
  // Honours the where-shapes the distiller uses (and the old ones), so the test exercises the query, not a canned list.
  const findMany = vi.fn(async (args: {
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
  const prisma = {
    chatConversation: {
      findMany,
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, title: null, messages: state.messages })),
    },
    brainMemory: {
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((k) => state.distills.has(k)).map((k) => ({ key: k, updatedAt: state.distills.get(k)! })),
      ),
      findUnique: vi.fn(async () => null),
    },
  };
  const admitMemory = vi.fn(async (input: { category: string }) => ({ id: `mem-${input.category}`, evidenceClass: "x", memoryKind: "derived" }));
  const aiChat = vi.fn(async () => ({
    provider: "ollama",
    content: JSON.stringify({ summary: "s", decisions: [], commitments: [], questions_still_open: ["q"], emotional_tone: "steady", next_follow_up: null }),
  }));
  return { state, prisma, admitMemory, aiChat };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/brain/memory-admission", () => ({ admitMemory: h.admitMemory }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));

import { distillConversation, findEligibleConversations } from "@/lib/brain/session-distiller";

const ago = (ms: number) => new Date(Date.now() - ms);
const convo = (id: string, ageMs: number, extra: Partial<Convo> = {}): Convo => ({ id, updatedAt: ago(ageMs), archivedAt: null, messages: 6, ...extra });

beforeEach(() => {
  h.state.convos = [];
  h.state.distills = new Map();
  h.state.messages = [];
  vi.clearAllMocks();
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
    h.state.distills.set("arch", ago(85 * DAY));
    expect(await findEligibleConversations(10)).toEqual([]);
  });

  it("still re-distills a live chat that continued after its distill, and skips a fresh one", async () => {
    h.state.convos = [convo("continued", 2 * DAY), convo("fresh", 3 * DAY)];
    h.state.distills.set("continued", ago(5 * DAY));
    h.state.distills.set("fresh", ago(1 * DAY));
    expect(await findEligibleConversations(10)).toEqual(["continued"]);
  });

  it("does not redistill a backlog chat that already has a live distill, even if it was touched after it", async () => {
    h.state.convos = [convo("touched", 60 * DAY)];
    h.state.distills.set("touched", ago(90 * DAY));
    expect(await findEligibleConversations(10)).toEqual([]);
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

  it("a chat whose last message is 60 days old writes its summary but not the concerns block", async () => {
    h.state.messages = msgs(60 * DAY);
    expect(await distillConversation("old")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.admitMemory.mock.calls.some(([a]) => (a as { category: string }).category === "chat_summary")).toBe(true);
    expect(concernWrites()).toHaveLength(0);
  });

  it("a chat from yesterday still updates the concerns block", async () => {
    h.state.messages = msgs(1 * DAY);
    await distillConversation("recent");
    await new Promise((r) => setTimeout(r, 0));
    expect(concernWrites()).toHaveLength(1);
  });

  it("the summary is dated at the chat's last message, not today", async () => {
    h.state.messages = msgs(60 * DAY);
    await distillConversation("old");
    const summary = h.admitMemory.mock.calls.find(([a]) => (a as { category: string }).category === "chat_summary")![0] as { effectiveFrom: Date; source: string; evidenceRefs: string[] };
    expect(Date.now() - summary.effectiveFrom.getTime()).toBeGreaterThan(59 * DAY);
    expect(summary.source).toBe("session_distiller");
    expect(summary.evidenceRefs).toEqual(["conversation:old"]);
  });
});
