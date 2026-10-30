/**
 * Brain backfill W1, review round 1 (PR 3379): every other distiller test mocks admitMemory, so none could
 * see that the REAL write path gave a distill a 24h probation (remember() -> expiresAt now+24h) that the
 * nightly prune then tombstoned, after which the queue re-picked the chat forever. This one runs
 * distillConversation -> admitMemory -> brainMemory.remember() for real, over an in-memory brain_memories
 * store that applies where/data the way the database does. Only the model call and the embedding are faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const DAY = 86_400_000;

type Row = Record<string, unknown> & { id: string; category: string; key: string; deletedAt: Date | null; expiresAt: Date | null };

const h = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = [];
  let seq = 0;
  const matches = (r: Record<string, unknown>, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "category_key") {
        const ck = v as { category: string; key: string };
        return r.category === ck.category && r.key === ck.key;
      }
      if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => matches(r, w));
      if (k === "AND") return (v as Array<Record<string, unknown>>).every((w) => matches(r, w));
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const op = v as Record<string, unknown>;
        if ("in" in op) return (op.in as unknown[]).includes(r[k]);
        if ("not" in op) return r[k] !== op.not;
        if ("lt" in op) return (r[k] as Date) < (op.lt as Date);
        if ("gt" in op) return (r[k] as Date) > (op.gt as Date);
        if ("gte" in op) return (r[k] as number) >= (op.gte as number);
        return true;
      }
      return r[k] === v || (v === null && r[k] == null);
    });
  const apply = (r: Record<string, unknown>, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "increment" in (v as object)) r[k] = (r[k] as number) + (v as { increment: number }).increment;
      else r[k] = v;
    }
    r.updatedAt = new Date();
    return r;
  };
  const brainMemory = {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      return r;
    }),
    findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => matches(r, where))),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => matches(r, where)).length),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const r = { id: `bm${++seq}`, seenCount: 1, confidence: 0.5, deletedAt: null, expiresAt: null, metadata: null, createdAt: new Date(), lastSeen: new Date(), ...data };
      rows.push(apply(r, {}));
      return r;
    }),
    update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      return apply(r, data);
    }),
    updateMany: vi.fn(async ({ where, data }: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) apply(r, data);
      return { count: hit.length };
    }),
  };
  const convo = {
    id: "c-old",
    title: null,
    messages: [3, 2, 1, 0].map((i) => ({ role: i % 2 ? "user" : "assistant", content: `message ${i}`, createdAt: new Date(Date.now() - 60 * 86_400_000 + i * 60_000) })),
  };
  const prisma: Record<string, unknown> = {
    brainMemory,
    chatConversation: {
      findUnique: vi.fn(async () => convo),
      findMany: vi.fn(async () => [{ id: convo.id, updatedAt: new Date(Date.now() - 60 * 86_400_000), archivedAt: null, _count: { messages: 4 } }]),
    },
    $queryRaw: vi.fn(async () => []),
    $queryRawUnsafe: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[]))),
  };
  const aiChat = vi.fn(async () => ({
    provider: "ollama",
    content: JSON.stringify({ summary: "Nour planned the week.", decisions: [], commitments: [], questions_still_open: [], emotional_tone: "steady", next_follow_up: null }),
  }));
  return { rows, prisma, aiChat };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => h.aiChat }));
vi.mock("@/lib/brain/embedding-utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/brain/embedding-utils")>()),
  storeMemoryEmbedding: vi.fn(async () => {}),
  storeGenericEmbedding: vi.fn(async () => {}),
}));

import { distillConversation, findEligibleConversations } from "@/lib/brain/session-distiller";

const summaries = () => (h.rows as Row[]).filter((r) => r.category === "chat_summary");

beforeEach(() => {
  h.rows.length = 0;
});

describe("distill -> admitMemory -> remember(), for real", () => {
  it("writes one durable chat_summary: no expiry, AGENT_INFERRED, source session_distiller, valid from the chat's last message", async () => {
    expect(await distillConversation("c-old")).not.toBeNull();
    const [row] = summaries();
    expect(summaries()).toHaveLength(1);
    expect(row.key).toBe("c-old");
    expect(row.expiresAt).toBeNull();
    expect(row.deletedAt).toBeNull();
    expect(row.source).toBe("session_distiller");
    expect(row.trustTier).toBe("AGENT_INFERRED");
    expect(Date.now() - (row.validFrom as Date).getTime()).toBeGreaterThan(59 * DAY);
  });

  it("once that row is soft-deleted, the queue never picks the chat again", async () => {
    await distillConversation("c-old");
    expect(await findEligibleConversations(10)).toEqual([]);
    summaries()[0].deletedAt = new Date();
    expect(await findEligibleConversations(10)).toEqual([]);
  });
});
