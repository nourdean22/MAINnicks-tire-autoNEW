/**
 * UI v3 W3b round 3 (A1b), the consumer end: the island hands the composer its "opening" reason exactly
 * while use-conversations reports isLoadingConvo, and nothing once the rows have landed.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ loading: false, reasons: [] as Array<string | undefined> }));

vi.mock("@/features/chat-v2/hooks/use-chat-stream", () => ({
  useChatStream: () => ({
    messages: [],
    status: "ready",
    error: undefined,
    isStreaming: false,
    sendText: () => {},
    append: async () => {},
    stop: () => {},
    stopTurn: () => {},
    stopped: null,
    hold: null,
    regenerate: async () => {},
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
vi.mock("@/features/chat-v2/components/chat-composer", () => ({
  ChatComposer: (props: { disabledReason?: string }) => {
    h.reasons.push(props.disabledReason);
    return <form data-composer />;
  },
}));
vi.mock("@/features/chat-v2/components/chat-media-dock", () => ({ ChatMediaDock: () => null }));
vi.mock("@/features/chat-v2/components/chat-media-focus-panel", () => ({ ChatMediaFocusPanel: () => null }));
vi.mock("@/features/chat-v2/components/chat-message-list", () => ({ ChatMessageList: () => <div data-list /> }));
vi.mock("@/features/chat-v2/components/chat-capability-indicator", () => ({ ChatCapabilityIndicator: () => null }));
vi.mock("@/features/chat-v2/components/operator-conversation-drawer", () => ({ OperatorConversationDrawer: () => null }));
vi.mock("@/components/chat/realtime-voice-overlay", () => ({ RealtimeVoiceOverlay: () => null }));
vi.mock("@/components/chat/memory-inspector-sidebar", () => ({ MemoryInspectorSidebar: () => null }));

import { ChatIsland, COMPOSER_OPENING_REASON } from "@/features/chat-v2/components/chat-island";

let root: Root;
beforeEach(() => {
  h.reasons.length = 0;
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));

describe("the island disables the composer while a conversation opens", () => {
  it("passes the opening reason while isLoadingConvo", () => {
    h.loading = true;
    act(() => root.render(<ChatIsland />));
    expect(h.reasons.at(-1)).toBe(COMPOSER_OPENING_REASON);
  });

  it("CONTROL: passes nothing once the conversation is on screen", () => {
    h.loading = false;
    act(() => root.render(<ChatIsland />));
    expect(h.reasons.at(-1)).toBeUndefined();
  });
});
