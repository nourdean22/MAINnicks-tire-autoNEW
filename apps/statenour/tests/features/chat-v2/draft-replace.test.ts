/**
 * tests/features/chat-v2/draft-replace.test.ts · audit 09-F11 (task B6).
 *
 * Tapping your own message, its Edit button, or a slash suggestion used to
 * call setDraft() straight over whatever was typed: text lost, no undo. A
 * non-empty draft now waits for a second tap on an in-DOM "Replace draft?"
 * confirm (never window.confirm: silently suppressed in the iOS PWA).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const state = () => useChatUiStore.getState();

beforeEach(() => {
  useChatUiStore.setState({ draft: "", editingMessageId: null, activeConversationId: null, draftReplace: null });
});

describe("offerDraft · an empty composer takes the text at once", () => {
  it("fills the draft and arms edit-resend with no question", () => {
    state().offerDraft("sent message", "msg1");
    expect(state().draft).toBe("sent message");
    expect(state().editingMessageId).toBe("msg1");
    expect(state().draftReplace).toBeNull();
  });

  it("the same text already in the composer is not a replacement", () => {
    state().setDraft("same");
    state().offerDraft("same", "msg1");
    expect(state().draftReplace).toBeNull();
    expect(state().editingMessageId).toBe("msg1");
  });
});

describe("offerDraft · a typed draft is never overwritten on the first tap", () => {
  beforeEach(() => state().setDraft("half-typed thought"));

  it("keeps the typed text and asks", () => {
    state().offerDraft("sent message", "msg1");
    expect(state().draft).toBe("half-typed thought");
    expect(state().editingMessageId).toBeNull();
    expect(state().draftReplace).toEqual({ text: "sent message", editingMessageId: "msg1" });
  });

  it("second tap Replace: applies the text and arms editing", () => {
    state().offerDraft("sent message", "msg1");
    state().confirmDraftReplace();
    expect(state().draft).toBe("sent message");
    expect(state().editingMessageId).toBe("msg1");
    expect(state().draftReplace).toBeNull();
  });

  it("Keep draft: the typed text survives and nothing is armed", () => {
    state().offerDraft("sent message", "msg1");
    state().cancelDraftReplace();
    expect(state().draft).toBe("half-typed thought");
    expect(state().editingMessageId).toBeNull();
    expect(state().draftReplace).toBeNull();
  });

  it("a suggestion (no message id) asks the same way", () => {
    state().offerDraft("/today prompt");
    expect(state().draft).toBe("half-typed thought");
    state().confirmDraftReplace();
    expect(state().draft).toBe("/today prompt");
  });

  it("switching conversations drops the pending replace (its message id is from the old thread)", () => {
    state().offerDraft("sent message", "msg1");
    state().setActiveConversationId("other");
    expect(state().draftReplace).toBeNull();
    state().confirmDraftReplace();
    expect(state().draft).toBe("half-typed thought");
    expect(state().editingMessageId).toBeNull();
  });
});
