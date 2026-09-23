import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstMock = vi.fn();
const deleteMock = vi.fn();
const updateMock = vi.fn();
const dropEmbeddingsMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findFirst: (...args: any[]) => findFirstMock(...args),
      update: (...args: any[]) => updateMock(...args),
    },
    personProfile: {
      delete: (...args: any[]) => deleteMock(...args),
    },
  },
}));

// 2026-09-18 · undoing person.create now drops the person's vector_embeddings
// row too. MOCKED EXPLICITLY, not left to the real module: dropEmbeddingsForSource
// try/catches and returns 0, so an unmocked prisma.vectorEmbedding would make the
// cascade throw, be swallowed, and leave this suite green while the cascade did
// nothing at all.
vi.mock("@/lib/brain/memory-tombstone", () => ({
  dropEmbeddingsForSource: (...args: any[]) => dropEmbeddingsMock(...args),
}));

import { consumeUndoToken } from "@/lib/services/undo-token";

describe("consumeUndoToken for person.create", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findFirstMock.mockReset();
    deleteMock.mockReset();
    updateMock.mockReset();
    dropEmbeddingsMock.mockReset();
    dropEmbeddingsMock.mockResolvedValue(1);
  });

  it("successfully deletes the created person when a valid token is consumed", async () => {
    const token = "undo_person123_456789";
    const personId = "person-123";

    findFirstMock.mockResolvedValue({
      id: "memory-row-id",
      category: "undo_token",
      key: token,
      content: JSON.stringify({
        toolName: "person.create",
        personId,
      }),
      expiresAt: new Date(Date.now() + 10000),
      deletedAt: null,
    });

    deleteMock.mockResolvedValue({ id: personId });
    updateMock.mockResolvedValue({ id: "memory-row-id" });

    const result = await consumeUndoToken(token);

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { category: "undo_token", key: token },
      select: { id: true, content: true, expiresAt: true, deletedAt: true },
    });
    expect(deleteMock).toHaveBeenCalledWith({
      where: { id: personId },
    });
    expect(updateMock).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      undone: true,
      toolName: "person.create",
      entityId: personId,
    });
  });

  it("returns alreadyUndone: true if the token is already consumed", async () => {
    const token = "undo_person123_456789";

    findFirstMock.mockResolvedValue({
      id: "memory-row-id",
      category: "undo_token",
      key: token,
      content: JSON.stringify({
        toolName: "person.create",
        personId: "person-123",
      }),
      expiresAt: new Date(Date.now() + 10000),
      deletedAt: new Date(),
    });

    const result = await consumeUndoToken(token);

    expect(deleteMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      alreadyUndone: true,
    });
  });

  it("throws a 404 error if the token has expired", async () => {
    const token = "undo_person123_456789";

    findFirstMock.mockResolvedValue({
      id: "memory-row-id",
      category: "undo_token",
      key: token,
      content: JSON.stringify({
        toolName: "person.create",
        personId: "person-123",
      }),
      expiresAt: new Date(Date.now() - 10000), // expired 10s ago
      deletedAt: null,
    });

    await expect(consumeUndoToken(token)).rejects.toThrow("token expired");
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("consumeUndoToken · person.create embedding tombstone", () => {
  it("drops the person's embedding, so the undo is not half-done", async () => {
    const token = "undo_person999_111111";
    const personId = "person-999";
    findFirstMock.mockResolvedValue({
      id: "memory-row-id",
      category: "undo_token",
      key: token,
      content: JSON.stringify({ toolName: "person.create", personId }),
      expiresAt: new Date(Date.now() + 10000),
      deletedAt: null,
    });
    deleteMock.mockResolvedValue({ id: personId });
    updateMock.mockResolvedValue({ id: "memory-row-id" });

    await consumeUndoToken(token);

    expect(dropEmbeddingsMock).toHaveBeenCalledWith(
      "person_profile",
      [personId],
      expect.any(String),
    );
  });
});
