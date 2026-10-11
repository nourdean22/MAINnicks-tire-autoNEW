/**
 * tests/features/chat-v2/deep-link-offer-draft.test.ts · audit 09-F11 + 09-F12 (task B6).
 *
 * With the draft now restored after a reload, a suggestion opened through a
 * ?q= deep link meets a non-empty composer far more often. Effects run child
 * first, so the composer's restore lands before the island's prefill, and
 * the old rule ("never clobber") then dropped the suggestion without a word.
 * The prefill now OFFERS the prompt: an empty composer takes it, a typed
 * draft gets the "Replace draft?" question and survives until a second tap.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { consumeChatDeepLink } from "@/features/chat-v2/hooks/use-chat-deep-link-prefill";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

function slice() {
  const { draft, setDraft, offerDraft, setActiveConversationId, setHistoryDrawerOpen } = useChatUiStore.getState();
  return { draft, setDraft, offerDraft, setActiveConversationId, setHistoryDrawerOpen };
}

beforeEach(() => {
  useChatUiStore.setState({ draft: "", editingMessageId: null, draftReplace: null, activeConversationId: null });
});

describe("consumeChatDeepLink · offers the prompt instead of dropping it", () => {
  it("a restored draft keeps its text and the suggestion waits behind Replace draft?", () => {
    useChatUiStore.setState({ draft: "restored after reload" });
    consumeChatDeepLink("?q=incoming%20suggestion", slice());
    expect(useChatUiStore.getState().draft).toBe("restored after reload");
    expect(useChatUiStore.getState().draftReplace).toEqual({ text: "incoming suggestion" });
  });

  it("an empty composer still takes the prompt at once", () => {
    consumeChatDeepLink("?q=incoming%20suggestion", slice());
    expect(useChatUiStore.getState().draft).toBe("incoming suggestion");
    expect(useChatUiStore.getState().draftReplace).toBeNull();
  });
});
