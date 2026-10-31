// @vitest-environment jsdom
/**
 * U1 (2026-10-30) · more room for the conversation.
 *
 * Before: the docked Context & Evidence column reopened on every load at desktop width however
 * often it was closed; the composer stopped growing at 200 px even on a tall desktop screen; and the
 * pulse ticker rotated under the composer on /chat. Now: the docked choice is remembered (desktop
 * only: below xl the panel is an overlay and starts closed), the composer may take 40% of a tall
 * viewport (still a quarter with the phone keyboard up), and /chat has no ticker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ sidebar: [] as Array<{ open: boolean; docked?: boolean; onClose: () => void }> }));

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
  MemoryInspectorSidebar: (props: { open: boolean; docked?: boolean; onClose: () => void }) => {
    h.sidebar.push({ open: props.open, docked: props.docked, onClose: props.onClose });
    return props.open ? <aside data-inspector /> : null;
  },
}));

import { ChatIsland } from "@/features/chat-v2/components/chat-island";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";
import { composerCap } from "@/features/chat-v2/lib/composer-cap";

let container: HTMLDivElement;
let root: Root;
const last = () => h.sidebar[h.sidebar.length - 1];

function stubViewport(xl: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: xl && query.includes("1280"), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

beforeEach(() => {
  h.sidebar.length = 0;
  window.localStorage.clear();
  useChatUiStore.setState({ memoryInspectorOpen: null, historyDrawerOpen: false, privateMode: false });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("U1 · the docked context panel remembers being closed", () => {
  it("closing it at desktop width is saved, and the next load starts closed", () => {
    stubViewport(true);
    act(() => root.render(<ChatIsland />));
    expect(last().open).toBe(true);
    act(() => last().onClose());
    expect(window.localStorage.getItem("chat:inspectorDocked")).toBe("0");

    act(() => root.unmount());
    useChatUiStore.setState({ memoryInspectorOpen: null });
    root = createRoot(container);
    act(() => root.render(<ChatIsland />));
    expect(last().open).toBe(false);
  });

  it("CONTROL: with nothing saved, desktop starts docked open", () => {
    stubViewport(true);
    act(() => root.render(<ChatIsland />));
    expect(last().open).toBe(true);
  });

  it("below desktop width a saved 'open' does not open the overlay over the chat", () => {
    window.localStorage.setItem("chat:inspectorDocked", "1");
    stubViewport(false);
    act(() => root.render(<ChatIsland />));
    expect(last().open).toBe(false);
  });
});

describe("U1 · composer height cap", () => {
  it("a tall screen gives the composer 40% (up to 400 px)", () => {
    expect(composerCap(900)).toBe(360);
    expect(composerCap(1400)).toBe(400);
  });
  it("CONTROL: with the phone keyboard up (short viewport) it stays a quarter", () => {
    expect(composerCap(500)).toBe(125);
    expect(composerCap(120)).toBe(44);
  });
});
