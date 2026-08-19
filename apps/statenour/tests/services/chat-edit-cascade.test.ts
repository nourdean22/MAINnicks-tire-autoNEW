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
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      deleteMany: mocks.deleteMany,
    },
  },
}));
vi.mock("@/lib/db/entity-audit", () => ({ logUpdate: vi.fn() }));

import { deleteMessageCascade, MessageNotFoundError } from "@/lib/services/chat-edit";

const row = {
  id: "cuid_db_row",
  conversationId: "conv1",
  createdAt: new Date("2026-08-18T12:00:00Z"),
  content: "original",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deleteMany.mockResolvedValue({ count: 3 });
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
