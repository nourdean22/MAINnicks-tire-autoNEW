/**
 * B1 consumer end (2026-11-01): readConversation, the one loader the chat calls on reload,
 * keeps a valid stored tool card and drops a corrupt one without losing the message.
 */
import { describe, it, expect, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { chatConversation: { findUnique: (a: unknown) => findUnique(a) } } }));

import { readConversation } from "@/lib/services/chat-conversation-read";

const at = new Date("2026-11-01T12:00:00Z");
const message = (parts: unknown[]) => ({
  id: "m1", role: "assistant", content: "Here is what I found.", model: null, attachments: null, parts,
  clientMessageId: null, parentMessageId: null, branchId: null, editedAt: null, editHistory: null,
  streamingState: "complete", errorDetails: null, provider: null, routerReason: null, latencyMs: null,
  firstTokenLatencyMs: null, costCents: null, promptTokens: null, completionTokens: null,
  feedbackScore: null, tokenUsage: null, createdAt: at,
});
const conversation = (parts: unknown[]) => ({
  id: "c1", title: "t", createdAt: at, updatedAt: at, pinnedSummary: null, topicTags: [], archivedAt: null,
  starredAt: null, mutedAt: null, lastActiveAt: null, messageCount: 1, messages: [message(parts)],
});

const card = { type: "tool-getTasks", toolCallId: "c1", input: {}, state: "output-available", output: { tasks: [] } };
const text = { type: "text", text: "Here is what I found." };

describe("readConversation hands the chat its stored tool cards", () => {
  it("a valid card loads ahead of the text", async () => {
    findUnique.mockResolvedValueOnce(conversation([card, text]));
    const out = await readConversation({ id: "c1" });
    expect((out.messages[0].parts as Array<{ type: string }>).map((p) => p.type)).toEqual(["tool-getTasks", "text"]);
  });

  it("a corrupt card is dropped and the message still loads with its text", async () => {
    findUnique.mockResolvedValueOnce(conversation([{ ...card, state: "not-a-state" }, text]));
    const out = await readConversation({ id: "c1" });
    expect(out.messages[0].parts).toEqual([text]);
  });
});
