/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): auto-rename only bailed on
 * provider "none", so the "emergency" apology became the conversation title
 * ("I'm having trouble connecting to my AI providers right now...") and the
 * chat_renamed marker then blocked any later real rename.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));
const db = vi.hoisted(() => ({
  convFind: vi.fn(),
  convUpdate: vi.fn(),
  msgCount: vi.fn(),
  msgFind: vi.fn(),
  auditFind: vi.fn(),
  auditCreate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatConversation: { findUnique: db.convFind, update: db.convUpdate },
    chatMessage: { count: db.msgCount, findMany: db.msgFind },
    auditEvent: { findFirst: db.auditFind, create: db.auditCreate },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { maybeAutoRename } from "@/lib/chat/auto-rename";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};

beforeEach(() => {
  mockChat.mockReset();
  db.convFind.mockReset().mockResolvedValue({ id: "c1", title: "New chat" });
  db.convUpdate.mockReset().mockResolvedValue({});
  db.msgCount.mockReset().mockResolvedValue(5);
  db.msgFind.mockReset().mockResolvedValue([{ role: "user", content: "help me price winter tires" }]);
  db.auditFind.mockReset().mockResolvedValue(null);
  db.auditCreate.mockReset().mockResolvedValue({});
});

describe("maybeAutoRename - provider sentinel", () => {
  it("does not rename the conversation to the outage text", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await maybeAutoRename("c1");
    expect(db.convUpdate).not.toHaveBeenCalled();
    expect(db.auditCreate).not.toHaveBeenCalled();
  });

  it("control: after the outage, the next message renames the same conversation", async () => {
    // Same id as above: the in-flight guard must be released when a run bails.
    mockChat.mockResolvedValue({ content: "Pricing winter tires", provider: "ollama", model: "m" });
    await maybeAutoRename("c1");
    expect(db.convUpdate.mock.calls[0][0].data.title).toBe("Pricing winter tires");
  });
});
