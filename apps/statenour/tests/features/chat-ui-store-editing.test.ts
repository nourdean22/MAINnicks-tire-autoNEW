/**
 * tests/features/chat-ui-store-editing.test.ts (2026-08-18 self-audit).
 *
 * The sharp edge the edit-resend fix shipped: a casual bubble tap arms
 * a destructive replace. Two disarm guards are load-bearing:
 *   · emptying the draft disarms (cleared prefill = new intent — the
 *     "tap, clear, type new question, send" path must never cascade)
 *   · switching conversations disarms (a stale id would truncate the
 *     WRONG thread)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

beforeEach(() => {
  useChatUiStore.setState({ draft: "", editingMessageId: null, activeConversationId: null });
});

describe("chat-ui-store · edit-resend disarm guards", () => {
  it("arms and holds while the draft carries text", () => {
    const s = useChatUiStore.getState();
    s.setDraft("original message text");
    s.setEditingMessageId("msg1");
    useChatUiStore.getState().setDraft("original message text, edited");
    expect(useChatUiStore.getState().editingMessageId).toBe("msg1");
  });

  it("DISARMS when the draft is emptied — cleared prefill is new intent", () => {
    const s = useChatUiStore.getState();
    s.setDraft("prefilled from a casual tap");
    s.setEditingMessageId("msg1");
    useChatUiStore.getState().setDraft("");
    expect(useChatUiStore.getState().editingMessageId).toBeNull();
    // Typing fresh text afterwards must NOT re-arm.
    useChatUiStore.getState().setDraft("a brand new question");
    expect(useChatUiStore.getState().editingMessageId).toBeNull();
  });

  it("whitespace-only counts as empty", () => {
    const s = useChatUiStore.getState();
    s.setDraft("text");
    s.setEditingMessageId("msg1");
    useChatUiStore.getState().setDraft("   ");
    expect(useChatUiStore.getState().editingMessageId).toBeNull();
  });

  it("DISARMS on conversation switch — a stale id would truncate the wrong thread", () => {
    const s = useChatUiStore.getState();
    s.setDraft("editing something");
    s.setEditingMessageId("msg-from-convo-A");
    useChatUiStore.getState().setActiveConversationId("convo-B");
    expect(useChatUiStore.getState().editingMessageId).toBeNull();
  });
});
