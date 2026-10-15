/**
 * The consumer end of the live Retry check. useChatStream asks a reader for the
 * saved turn before it replays after a stream error; the island has to hand it one
 * that really reaches useConversations (which owns the tRPC client). The hook is
 * created before useConversations, so the reader travels through a ref: this fails
 * if the ref is never assigned, or never read.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  hookOptions: undefined as undefined | { readSavedTurn?: (id: string, signal?: AbortSignal) => Promise<unknown> },
  readSavedTurn: undefined as undefined | ((id: string, signal?: AbortSignal) => Promise<unknown>),
}));

vi.mock("@/features/chat-v2/hooks/use-chat-stream", () => ({
  useChatStream: (options: { readSavedTurn?: (id: string, signal?: AbortSignal) => Promise<unknown> }) => {
    h.hookOptions = options;
    return {
      messages: [],
      status: "ready",
      error: undefined,
      isStreaming: false,
      sendText: () => {},
      append: async () => {},
      stop: () => {},
      stopTurn: () => {},
      stopped: null,
      regenerate: async () => {},
      setMessages: () => {},
      liveContextBlocks: null,
      lastTraceId: null,
    };
  },
}));
vi.mock("@/features/chat-v2/hooks/use-tts", () => ({ useTts: () => ({}) }));
vi.mock("@/features/chat-v2/hooks/use-chat-deep-link-prefill", () => ({ useChatDeepLinkPrefill: () => {} }));
vi.mock("@/hooks/use-conversations", () => ({
  useConversations: () => ({ convos: [], activeId: null, pinnedIds: new Set(), isLoadingConvo: false, readSavedTurn: h.readSavedTurn }),
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
  return () => act(() => root.unmount());
}

beforeEach(() => {
  h.hookOptions = undefined;
  h.readSavedTurn = undefined;
});

describe("the island hands the chat a saved-turn reader", () => {
  it("the reader the hook receives asks useConversations.readSavedTurn, with the conversation id and the abort signal", async () => {
    const rows = [{ id: "a1", role: "assistant", tokenUsage: { toolReceipts: [] } }];
    h.readSavedTurn = vi.fn(async () => rows);
    const unmount = mount();
    const { signal } = new AbortController();

    const result = await h.hookOptions!.readSavedTurn!("c1", signal);

    expect(h.readSavedTurn).toHaveBeenCalledWith("c1", signal);
    expect(result).toBe(rows);
    unmount();
  });

  it("with no reader available the hook's reader says null, which holds Retry", async () => {
    h.readSavedTurn = undefined;
    const unmount = mount();

    await expect(h.hookOptions!.readSavedTurn!("c1")).resolves.toBeNull();
    unmount();
  });
});
