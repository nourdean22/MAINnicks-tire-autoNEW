/**
 * The readers that scan his own chat words for a person: a nickname counts as the person there too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chat: vi.fn(),
  people: vi.fn(),
  ai: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findMany: h.chat },
    personProfile: { findMany: h.people },
    brainMemory: { upsert: h.upsert, findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => vi.fn(), tracedAiChat: h.ai }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { chatSnippets } from "@/lib/brain/people-intelligence";
import { scanKeptWords } from "@/lib/brain/kept-word-tracker";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("chatSnippets", () => {
  it("reads messages that use a nickname, not only the name", async () => {
    h.chat.mockResolvedValue([{ content: "mom said the move is on" }, { content: "a moment later" }]);
    expect(await chatSnippets("Yummah", 3, undefined, undefined, ["mom"])).toEqual(["mom said the move is on"]);
    const where = (h.chat.mock.calls[0][0] as { where: { OR: unknown[] } }).where;
    expect(where.OR).toEqual([
      { content: { contains: "Yummah", mode: "insensitive" } },
      { content: { contains: "mom", mode: "insensitive" } },
    ]);
  });
});

describe("scanKeptWords", () => {
  const msg = { id: "m1", role: "user", content: "mom will send the papers tomorrow", conversationId: "c", createdAt: new Date() };

  it("a promise said about a nickname lands on its owner", async () => {
    h.chat.mockResolvedValue([msg]);
    h.people.mockResolvedValue([{ id: "y", name: "Yummah", metadata: { nicknames: ["mom"] } }]);
    h.ai.mockResolvedValue({ content: JSON.stringify({ promises: [{ personName: "Mom", promise: "send papers", dueHint: null }] }) });
    h.upsert.mockResolvedValue({});
    expect((await scanKeptWords()).newPromises).toBe(1);
    const key = (h.upsert.mock.calls[0][0] as { where: { category_key: { key: string } } }).where.category_key.key;
    expect(key).toBe("y:m1");
  });

  it("a shared nickname lands on nobody", async () => {
    h.chat.mockResolvedValue([msg]);
    h.people.mockResolvedValue([
      { id: "y", name: "Yummah", metadata: { nicknames: ["mom"] } },
      { id: "o", name: "Olivia", metadata: { nicknames: ["mom"] } },
    ]);
    expect((await scanKeptWords()).newPromises).toBe(0);
    expect(h.ai).not.toHaveBeenCalled();
  });
});
