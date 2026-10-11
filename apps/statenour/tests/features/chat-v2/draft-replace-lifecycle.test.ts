/**
 * tests/features/chat-v2/draft-replace-lifecycle.test.ts · task P2-B6 item 4.
 *
 * A pending "Replace draft?" belongs to the draft it was asked about.
 *   · Sending that draft, or clearing it by hand, ends the question: a later
 *     tap on Replace must not drop old text into a fresh composer.
 *   · Replace arms only the edit the offer carried. Falling back to the
 *     store's editingMessageId re-armed an older edit-resend, so sending a
 *     suggestion cascade-deleted the message that was being edited before.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const state = () => useChatUiStore.getState();

beforeEach(() => {
  useChatUiStore.setState({ draft: "", editingMessageId: null, activeConversationId: null, draftReplace: null });
});

describe("the question ends with the draft it was about", () => {
  beforeEach(() => {
    state().setDraft("half-typed thought");
    state().offerDraft("sent message", "msg1");
  });

  it("a send (clearConversationDraft) drops the pending replace", () => {
    state().clearConversationDraft();
    expect(state().draftReplace).toBeNull();
  });

  it("clearing the composer by hand drops the pending replace", () => {
    state().setDraft("");
    expect(state().draftReplace).toBeNull();
  });

  it("CONTROL: typing more keeps the question open", () => {
    state().setDraft("half-typed thought, longer");
    expect(state().draftReplace).toEqual({ text: "sent message", editingMessageId: "msg1" });
  });
});

describe("Replace arms only the offer's own edit", () => {
  it("a suggestion offered while editing msg1 does not re-arm the msg1 edit-resend", () => {
    state().offerDraft("msg1 text", "msg1");
    state().setDraft("msg1 text, edited");
    expect(state().editingMessageId).toBe("msg1");

    state().offerDraft("/today prompt");
    state().confirmDraftReplace();

    expect(state().draft).toBe("/today prompt");
    expect(state().editingMessageId).toBeNull();
  });

  it("CONTROL: an offer that carries a message id arms that edit", () => {
    state().setDraft("typed");
    state().offerDraft("msg2 text", "msg2");
    state().confirmDraftReplace();
    expect(state().editingMessageId).toBe("msg2");
  });
});
