/**
 * UI v3 W3b round 3 (B1, desktop): at xl the Context and Evidence inspector is docked open beside the
 * conversation by default; below xl it stays the opt-in overlay. The island decides from the viewport
 * (matchMedia) when the operator has not chosen; an explicit close wins.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ sidebar: [] as Array<{ open: boolean; docked?: boolean }> }));

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
  MemoryInspectorSidebar: (props: { open: boolean; docked?: boolean }) => {
    h.sidebar.push({ open: props.open, docked: props.docked });
    return props.open ? <aside data-inspector /> : null;
  },
}));

import { ChatIsland } from "@/features/chat-v2/components/chat-island";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

let container: HTMLDivElement;
let root: Root;

function stubViewport(xl: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: xl && query.includes("1280"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  h.sidebar.length = 0;
  useChatUiStore.setState({ memoryInspectorOpen: null, historyDrawerOpen: false, privateMode: false });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const last = () => h.sidebar.at(-1)!;

describe("the inspector at xl (chat-island)", () => {
  it("is docked open by default when the operator has not chosen", () => {
    stubViewport(true);
    act(() => root.render(<ChatIsland />));
    expect(last()).toEqual({ open: true, docked: true });
    expect(container.querySelector("[data-inspector]")).not.toBeNull();
    const brain = container.querySelector('button[aria-label="Context and memory"]') as HTMLButtonElement;
    expect(brain.getAttribute("aria-pressed")).toBe("true");
  });

  it("sits beside the conversation column, which keeps the list and the composer together", () => {
    stubViewport(true);
    act(() => root.render(<ChatIsland />));
    const inspector = container.querySelector("[data-inspector]") as HTMLElement;
    const column = inspector.previousElementSibling as HTMLElement;
    expect(column, "the inspector has no conversation column before it").not.toBeNull();
    expect(column.querySelector("[data-list]")).not.toBeNull();
    expect(column.querySelector("[data-composer]")).not.toBeNull();
  });

  it("an explicit close wins over the viewport default", () => {
    stubViewport(true);
    act(() => root.render(<ChatIsland />));
    const brain = container.querySelector('button[aria-label="Context and memory"]') as HTMLButtonElement;
    act(() => brain.click());
    expect(last().open).toBe(false);
    expect(container.querySelector("[data-inspector]")).toBeNull();
  });

  it("CONTROL: below xl it stays closed until opened, and is not docked", () => {
    stubViewport(false);
    act(() => root.render(<ChatIsland />));
    expect(last()).toEqual({ open: false, docked: false });
    const brain = container.querySelector('button[aria-label="Context and memory"]') as HTMLButtonElement;
    expect(brain.getAttribute("aria-pressed")).toBe("false");
  });

  it("CONTROL: with no matchMedia at all (SSR, old jsdom) it reads as not xl", () => {
    vi.stubGlobal("matchMedia", undefined);
    act(() => root.render(<ChatIsland />));
    expect(last()).toEqual({ open: false, docked: false });
  });
});
