/**
 * BDN-004 · the deep-link prefill wire must actually reach the composer's
 * store. 13 surfaces hand context to /chat via ?q= / ?seed= / ?prompt=
 * (three historical vocabularies) and ?cid= — all silently dropped since
 * the chat-v2 migration orphaned the old handler. These pin the restored
 * logic against the REAL zustand store (module singleton — the same one
 * the composer binds), via the exported pure consumer.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { consumeChatDeepLink } from "@/features/chat-v2/hooks/use-chat-deep-link-prefill";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

function slice() {
  const { draft, setDraft, setActiveConversationId, setHistoryDrawerOpen } =
    useChatUiStore.getState();
  return { draft, setDraft, setActiveConversationId, setHistoryDrawerOpen };
}

beforeEach(() => {
  useChatUiStore.setState({ draft: "", activeConversationId: null, historyDrawerOpen: false });
});

describe("consumeChatDeepLink", () => {
  it("prefills the draft from ?q=", () => {
    consumeChatDeepLink("?q=explain%20this%20failure", slice());
    expect(useChatUiStore.getState().draft).toBe("explain this failure");
  });

  it("accepts the ?seed= vocabulary", () => {
    consumeChatDeepLink("?seed=replay%20verdict", slice());
    expect(useChatUiStore.getState().draft).toBe("replay verdict");
  });

  it("accepts the ?prompt= vocabulary", () => {
    consumeChatDeepLink("?prompt=improve%20this%20photo", slice());
    expect(useChatUiStore.getState().draft).toBe("improve this photo");
  });

  it("never clobbers text the operator already typed", () => {
    useChatUiStore.setState({ draft: "half-typed thought" });
    consumeChatDeepLink("?q=incoming%20prefill", slice());
    expect(useChatUiStore.getState().draft).toBe("half-typed thought");
  });

  it("restores a conversation deep-link via ?cid=", () => {
    consumeChatDeepLink("?cid=conv_abc123", slice());
    expect(useChatUiStore.getState().activeConversationId).toBe("conv_abc123");
  });

  it("opens the history drawer via ?h=1 (nick-reasoner deep-link)", () => {
    consumeChatDeepLink("?h=1", slice());
    expect(useChatUiStore.getState().historyDrawerOpen).toBe(true);
  });

  it("does nothing with no params", () => {
    consumeChatDeepLink("", slice());
    expect(useChatUiStore.getState().draft).toBe("");
    expect(useChatUiStore.getState().activeConversationId).toBeNull();
    expect(useChatUiStore.getState().historyDrawerOpen).toBe(false);
  });
});
