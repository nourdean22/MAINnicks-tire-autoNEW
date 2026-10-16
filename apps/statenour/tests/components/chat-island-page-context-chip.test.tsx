/**
 * UI v3 W3b: the page-context chip above the composer. The consumer end of the controller's
 * `pageContext` and `detachPageContext`: the chip names the attached route, its x detaches for
 * this turn, and no chip renders when nothing is attached.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  pageContext: null as { route: string } | null,
  detach: vi.fn(),
}));

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
    pageContext: h.pageContext,
    detachPageContext: h.detach,
  }),
}));
vi.mock("@/features/chat-v2/hooks/use-tts", () => ({ useTts: () => ({ supported: false }) }));
vi.mock("@/features/chat-v2/hooks/use-chat-deep-link-prefill", () => ({ useChatDeepLinkPrefill: () => {} }));
vi.mock("@/hooks/use-conversations", () => ({
  useConversations: () => ({ convos: [], activeId: null, pinnedIds: new Set(), isLoadingConvo: false, listState: "ok" }),
}));
vi.mock("@/features/chat-v2/components/chat-composer", () => ({ ChatComposer: () => null }));
vi.mock("@/features/chat-v2/components/chat-media-dock", () => ({ ChatMediaDock: () => null }));
vi.mock("@/features/chat-v2/components/chat-media-focus-panel", () => ({ ChatMediaFocusPanel: () => null }));
vi.mock("@/features/chat-v2/components/chat-message-list", () => ({ ChatMessageList: () => null }));
vi.mock("@/features/chat-v2/components/chat-capability-indicator", () => ({ ChatCapabilityIndicator: () => null }));
vi.mock("@/features/chat-v2/components/operator-conversation-drawer", () => ({ OperatorConversationDrawer: () => null }));
vi.mock("@/components/chat/realtime-voice-overlay", () => ({ RealtimeVoiceOverlay: () => null }));
vi.mock("@/components/chat/memory-inspector-sidebar", () => ({ MemoryInspectorSidebar: () => null }));

import { ChatIsland } from "@/features/chat-v2/components/chat-island";

function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ChatIsland />));
  return { container, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  h.detach.mockReset();
});

describe("the page-context chip", () => {
  it("names the attached route and its x detaches it for this turn", () => {
    h.pageContext = { route: "/decisions/abc" };
    const { container, unmount } = mount();
    expect(container.textContent).toContain("Page context: /decisions/abc attached");
    const x = container.querySelector('button[aria-label="Detach page context for this turn"]') as HTMLButtonElement;
    expect(x).not.toBeNull();
    act(() => x.click());
    expect(h.detach).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("CONTROL: nothing attached, no chip", () => {
    h.pageContext = null;
    const { container, unmount } = mount();
    expect(container.textContent).not.toContain("Page context");
    expect(container.querySelector('button[aria-label="Detach page context for this turn"]')).toBeNull();
    unmount();
  });
});
