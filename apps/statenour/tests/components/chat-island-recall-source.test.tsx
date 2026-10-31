/**
 * U2 (2026-10-30) · the Context & Evidence panel shows what the reply was given, not a re-run.
 *
 * Before: the stream's memory.recalled event (what the model got) and a separate preview re-run of
 * recall on the last message both wrote the same list, so whichever landed last won, and a slow
 * preview replaced the real evidence with a different list. Now the stream event wins, the preview
 * only fills in when no event came for that message, and the source rides to the panel.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  last: null as null | { hits: string[]; source?: string },
  resolvePreview: (_v: unknown) => {},
}));

vi.mock("@/features/chat-v2/hooks/use-chat-stream", () => ({
  useChatStream: () => ({
    messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "what do I like" }] }],
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
  useConversations: () => ({ convos: [], activeId: null, pinnedIds: new Set(), isLoadingConvo: false, listState: "ok" }),
}));
vi.mock("@/features/chat-v2/components/chat-composer", () => ({ ChatComposer: () => <form data-composer /> }));
vi.mock("@/features/chat-v2/components/chat-media-dock", () => ({ ChatMediaDock: () => null }));
vi.mock("@/features/chat-v2/components/chat-media-focus-panel", () => ({ ChatMediaFocusPanel: () => null }));
vi.mock("@/features/chat-v2/components/chat-message-list", () => ({ ChatMessageList: () => <div data-list /> }));
vi.mock("@/features/chat-v2/components/chat-capability-indicator", () => ({ ChatCapabilityIndicator: () => null }));
vi.mock("@/features/chat-v2/components/operator-conversation-drawer", () => ({ OperatorConversationDrawer: () => null }));
vi.mock("@/components/chat/realtime-voice-overlay", () => ({ RealtimeVoiceOverlay: () => null }));
vi.mock("@/components/chat/memory-inspector-sidebar", () => ({
  MemoryInspectorSidebar: (props: { open: boolean; hits: Array<{ id: string }>; recallSource?: string }) => {
    h.last = { hits: props.hits.map((x) => x.id), source: props.recallSource };
    return null;
  },
}));
vi.mock("@/features/chat-v2/lib/inspector-recall", () => ({
  fetchInspectorRecall: () => new Promise((resolve) => { h.resolvePreview = resolve; }),
}));

import { ChatIsland } from "@/features/chat-v2/components/chat-island";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

let container: HTMLDivElement;
let root: Root;
const preview = { hits: [{ id: "p1", content: "x", category: "c", similarity: 0.5 }], provenance: "OK" };

beforeEach(() => {
  h.last = null;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("1280"), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  useChatUiStore.setState({ memoryInspectorOpen: true, historyDrawerOpen: false, privateMode: false });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const streamEvent = () =>
  window.dispatchEvent(new CustomEvent("cockpit-event", {
    detail: { type: "memory.recalled", payload: { hits: [{ id: "t1", content: "y", category: "c", similarity: 0.6 }], provenance: "OK" } },
  }));

describe("ChatIsland · recall source (U2)", () => {
  it("a preview that lands after the stream event does not replace what the reply used", async () => {
    act(() => root.render(<ChatIsland />));
    act(() => streamEvent());
    await act(async () => { h.resolvePreview(preview); await Promise.resolve(); });
    expect(h.last).toEqual({ hits: ["t1"], source: "turn" });
  });

  it("with no stream event, the preview fills in and is labelled a preview", async () => {
    act(() => root.render(<ChatIsland />));
    await act(async () => { h.resolvePreview(preview); await Promise.resolve(); });
    expect(h.last).toEqual({ hits: ["p1"], source: "preview" });
  });
});
