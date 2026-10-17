/**
 * PR #3090 review 4299648907: while a conversation is opening (isLoadingConvo) EVERY send entry point
 * in the island is gated, not only the composer: the drawer's "Verified recent actions" (sends
 * "/receipts"), the starters (onCommand) and the error card's Retry. A send that races the open would
 * land in a conversation the operator has not seen.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  loading: false,
  sendText: vi.fn(),
  regenerate: vi.fn(async () => {}),
  drawer: null as null | { onShowActions: () => void; actionsDisabled?: boolean },
  list: null as null | { onCommand?: (p: string) => void; onRetry?: () => void },
}));

vi.mock("@/features/chat-v2/hooks/use-chat-stream", () => ({
  useChatStream: () => ({
    messages: [],
    status: "ready",
    error: undefined,
    isStreaming: false,
    sendText: h.sendText,
    append: async () => {},
    stop: () => {},
    stopTurn: () => {},
    stopped: null,
    hold: null,
    regenerate: h.regenerate,
    resetTurn: () => {},
    setMessages: () => {},
    liveContextBlocks: null,
    lastTraceId: null,
    pageContext: null,
    detachPageContext: () => {},
  }),
}));
vi.mock("@/features/chat-v2/hooks/use-tts", () => ({ useTts: () => ({ supported: false }) }));
vi.mock("@/features/chat-v2/hooks/use-chat-deep-link-prefill", () => ({ useChatDeepLinkPrefill: () => {} }));
vi.mock("@/hooks/use-conversations", () => ({
  useConversations: () => ({ convos: [], activeId: null, pinnedIds: new Set(), isLoadingConvo: h.loading, listState: "ok" }),
}));
vi.mock("@/features/chat-v2/components/chat-composer", () => ({ ChatComposer: () => <form data-composer /> }));
vi.mock("@/features/chat-v2/components/chat-media-dock", () => ({ ChatMediaDock: () => null }));
vi.mock("@/features/chat-v2/components/chat-media-focus-panel", () => ({ ChatMediaFocusPanel: () => null }));
vi.mock("@/features/chat-v2/components/chat-message-list", () => ({
  ChatMessageList: (props: { onCommand?: (p: string) => void; onRetry?: () => void }) => {
    h.list = props;
    return <div data-list />;
  },
}));
vi.mock("@/features/chat-v2/components/chat-capability-indicator", () => ({ ChatCapabilityIndicator: () => null }));
vi.mock("@/features/chat-v2/components/operator-conversation-drawer", () => ({
  OperatorConversationDrawer: (props: { onShowActions: () => void; actionsDisabled?: boolean }) => {
    h.drawer = props;
    return null;
  },
}));
vi.mock("@/components/chat/realtime-voice-overlay", () => ({ RealtimeVoiceOverlay: () => null }));
vi.mock("@/components/chat/memory-inspector-sidebar", () => ({ MemoryInspectorSidebar: () => null }));

import { ChatIsland } from "@/features/chat-v2/components/chat-island";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

let root: Root;
beforeEach(() => {
  h.sendText.mockClear();
  h.regenerate.mockClear();
  h.drawer = null;
  h.list = null;
  useChatUiStore.setState({ historyDrawerOpen: true });
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));

describe("send entry points while a conversation opens", () => {
  it("Verified recent actions posts nothing during a slow open, and its button is disabled", () => {
    h.loading = true;
    act(() => root.render(<ChatIsland />));
    expect(h.drawer, "the drawer was not rendered").not.toBeNull();
    expect(h.drawer!.actionsDisabled).toBe(true);
    act(() => h.drawer!.onShowActions());
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it("the starters and Retry post nothing during a slow open", () => {
    h.loading = true;
    act(() => root.render(<ChatIsland />));
    act(() => h.list!.onCommand?.("/receipts"));
    act(() => h.list!.onRetry?.());
    expect(h.sendText).not.toHaveBeenCalled();
    expect(h.regenerate).not.toHaveBeenCalled();
  });

  it("CONTROL: once the conversation is on screen, each one sends", () => {
    h.loading = false;
    act(() => root.render(<ChatIsland />));
    expect(h.drawer!.actionsDisabled).toBe(false);
    act(() => h.drawer!.onShowActions());
    act(() => h.list!.onCommand?.("hello"));
    act(() => h.list!.onRetry?.());
    expect(h.sendText).toHaveBeenCalledWith("/receipts");
    expect(h.sendText).toHaveBeenCalledWith("hello");
    expect(h.regenerate).toHaveBeenCalledTimes(1);
  });
});
