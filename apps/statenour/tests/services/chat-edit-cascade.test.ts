/**
 * tests/services/chat-edit-cascade.test.ts (2026-08-18).
 *
 * Pins deleteMessageCascade's id resolution — the edit-resend flow's
 * load-bearing subtlety: a message the operator JUST sent still carries
 * its client-minted UUID in live useChat state (the DB row id is a
 * cuid; the UUID lands in clientMessageId via the idempotency upsert).
 * "Fix the message I just sent" is the #1 edit case and used to
 * NOT_FOUND.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
  dropEmbeddings: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      deleteMany: mocks.deleteMany,
    },
  },
}));
vi.mock("@/lib/db/entity-audit", () => ({ logUpdate: vi.fn() }));
// 2026-09-18 · deleteMessageCascade now drops the truncated messages'
// vector_embeddings rows too. chat_message is a LIVE index (2,473 rows, newest
// written the day this was added), so an edit used to strip the messages and
// leave searchable copies of them behind.
vi.mock("@/lib/brain/memory-tombstone", () => ({
  dropEmbeddingsForSource: mocks.dropEmbeddings,
}));

import { deleteMessageCascade, MessageNotFoundError } from "@/lib/services/chat-edit";

const row = {
  id: "cuid_db_row",
  conversationId: "conv1",
  createdAt: new Date("2026-08-18T12:00:00Z"),
  content: "original",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
  mocks.deleteMany.mockResolvedValue({ count: 3 });
  mocks.dropEmbeddings.mockResolvedValue(3);
});

describe("deleteMessageCascade · id resolution", () => {
  it("resolves by DB row id first (legacy path unchanged)", async () => {
    mocks.findUnique.mockResolvedValueOnce(row);

    const r = await deleteMessageCascade({ messageId: "cuid_db_row" });
    expect(r.deletedCount).toBe(3);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    // Cascade scope: same conversation, target's createdAt forward.
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv1", createdAt: { gte: row.createdAt } },
    });
  });

  it("falls back to clientMessageId — the just-sent-message case", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    mocks.findFirst.mockResolvedValueOnce(row);

    const r = await deleteMessageCascade({
      messageId: "3f2c9b1e-client-uuid",
    });
    expect(r.deletedCount).toBe(3);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientMessageId: "3f2c9b1e-client-uuid" },
      }),
    );
  });

  it("throws MessageNotFoundError when both lookups miss — nothing deleted", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    mocks.findFirst.mockResolvedValueOnce(null);

    await expect(deleteMessageCascade({ messageId: "ghost" })).rejects.toBeInstanceOf(
      MessageNotFoundError,
    );
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe("deleteMessageCascade · embedding tombstone", () => {
  it("drops the embeddings for every truncated message", async () => {
    mocks.findUnique.mockResolvedValueOnce(row);

    await deleteMessageCascade({ messageId: "cuid_db_row" });

    expect(mocks.dropEmbeddings).toHaveBeenCalledWith(
      "chat_message",
      ["m1", "m2", "m3"],
      expect.any(String),
    );
  });

  it("reads the ids BEFORE deleting — after the delete there is nothing to join against", async () => {
    mocks.findUnique.mockResolvedValueOnce(row);
    const order: string[] = [];
    mocks.findMany.mockImplementationOnce(async () => {
      order.push("read");
      return [{ id: "m1" }];
    });
    mocks.deleteMany.mockImplementationOnce(async () => {
      order.push("delete");
      return { count: 1 };
    });

    await deleteMessageCascade({ messageId: "cuid_db_row" });

    expect(order).toEqual(["read", "delete"]);
  });

  it("CANARY — a cascade that found no messages does not call the tombstone with junk", async () => {
    mocks.findUnique.mockResolvedValueOnce(row);
    mocks.findMany.mockResolvedValueOnce([]);

    await deleteMessageCascade({ messageId: "cuid_db_row" });

    expect(mocks.dropEmbeddings).toHaveBeenCalledWith("chat_message", [], expect.any(String));
  });
});
