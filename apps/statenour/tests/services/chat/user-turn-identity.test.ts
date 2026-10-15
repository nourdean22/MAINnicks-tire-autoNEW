/**
 * A user message is named by the id the client holds: the client-minted id on a live thread, the
 * DATABASE id on a hydrated one (use-conversations.ts maps id = chat_messages.id and keeps the
 * minted id in metadata). Every lookup that resolves a turn's user row must accept either, or the
 * first Regenerate of a loaded conversation writes a second copy of the user message
 * (2026-10-15, found while designing server-side turn idempotency).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; conversationId: string; role: string; clientMessageId: string | null; createdAt: Date; content: string };

const h = vi.hoisted(() => ({ rows: [] as unknown[], created: [] as unknown[] }));
const rows = () => h.rows as Row[];

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as Record<string, unknown>[]).some((w) => matches(row, w));
    return (row as unknown as Record<string, unknown>)[k] === v;
  });
}

vi.mock("@/lib/prisma", () => {
  const chatMessage = {
    findFirst: async (a: { where: Record<string, unknown>; orderBy?: { createdAt?: string } }) => {
      const list = rows().filter((r) => matches(r, a.where));
      if (a.orderBy?.createdAt === "asc") list.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
      return list[0] ? { ...list[0] } : null;
    },
    create: async (a: { data: Record<string, unknown> }) => {
      h.created.push(a.data);
      return { id: "new-row" };
    },
  };
  const passthrough = { update: async () => ({}), create: async () => ({ id: "x" }), findFirst: async () => null, findUnique: async () => null };
  const prisma = new Proxy({}, {
    get: (_t, prop: string) => (prop === "chatMessage" ? chatMessage : passthrough),
  });
  return { prisma };
});
vi.mock("@/lib/brain/importance-scorer", () => ({ persistIfImportant: async () => ({ persisted: false }) }));
vi.mock("@/lib/brain/task-completion-detector", () => ({ detectTaskCompletion: async () => null }));
vi.mock("@/lib/agent/turn-context", () => ({ currentTurn: () => null }));

import { persistUserTurn } from "@/lib/services/chat/persist-user-turn";
import { findUserTurnRow } from "@/lib/services/chat/user-turn-identity";

const log = { info: vi.fn(), warn: vi.fn() };
const send = (id: string) =>
  persistUserTurn({
    convId: "conv-1",
    lastUserMsg: { id, role: "user", parts: [{ type: "text", text: "what is on my plate" }] },
    userContent: "what is on my plate",
    log,
  });

beforeEach(() => {
  h.rows = [{ id: "cuid-1", conversationId: "conv-1", role: "user", clientMessageId: "uuid-1", createdAt: new Date(1_000), content: "what is on my plate" }];
  h.created = [];
  vi.clearAllMocks();
});

describe("persistUserTurn dedupe", () => {
  it("a live thread re-sending the minted id writes nothing (control: already worked)", async () => {
    await expect(send("uuid-1")).resolves.toBe("conv-1");
    expect(h.created).toHaveLength(0);
  });

  it("a hydrated thread naming the same message by its database id writes nothing", async () => {
    await expect(send("cuid-1")).resolves.toBe("conv-1");
    expect(h.created).toHaveLength(0);
  });

  it("a genuinely new message is still written (the instrument can see a create)", async () => {
    await send("uuid-2");
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({ conversationId: "conv-1", clientMessageId: "uuid-2" });
  });
});

describe("findUserTurnRow", () => {
  it("finds a row by its client-minted id", async () => {
    await expect(findUserTurnRow({ conversationId: "conv-1", messageId: "uuid-1" })).resolves.toMatchObject({ id: "cuid-1" });
  });

  it("finds the same row by its database id", async () => {
    await expect(findUserTurnRow({ conversationId: "conv-1", messageId: "cuid-1" })).resolves.toMatchObject({ id: "cuid-1", clientMessageId: "uuid-1" });
  });

  it("does not cross conversations when one is named", async () => {
    await expect(findUserTurnRow({ conversationId: "conv-2", messageId: "uuid-1" })).resolves.toBeNull();
  });

  it("finds a first-send replay that has no conversation yet, by the minted id", async () => {
    await expect(findUserTurnRow({ conversationId: null, messageId: "uuid-1" })).resolves.toMatchObject({ id: "cuid-1" });
  });

  it("an unscoped lookup matches the minted id ONLY: a database id from some thread must not attach a request to it", async () => {
    await expect(findUserTurnRow({ conversationId: null, messageId: "cuid-1" })).resolves.toBeNull();
  });

  it("two rows sharing a minted id in different threads resolve the same way every time (oldest first)", async () => {
    h.rows = [
      { id: "cuid-late", conversationId: "conv-2", role: "user", clientMessageId: "uuid-x", createdAt: new Date(5_000), content: "x" },
      { id: "cuid-early", conversationId: "conv-1", role: "user", clientMessageId: "uuid-x", createdAt: new Date(1_000), content: "x" },
    ];
    for (let i = 0; i < 3; i += 1) await expect(findUserTurnRow({ conversationId: null, messageId: "uuid-x" })).resolves.toMatchObject({ id: "cuid-early" });
  });

  it("returns null for an unknown id", async () => {
    await expect(findUserTurnRow({ conversationId: "conv-1", messageId: "nobody" })).resolves.toBeNull();
  });
});
