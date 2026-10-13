/**
 * tests/components/chat-island-scroll-follow.test.tsx - review R3 wave A finding 3, task R3-15.
 *
 * Auto-follow turned off only on wheel/touchmove, so an iOS momentum flick, a
 * scrollbar drag, keys on <body> and VoiceOver scrolls moved the view with
 * scroll events alone: follow stayed on, the next content frame yanked the view
 * back down, and the jump button never showed. Follow only ever scrolls down,
 * so an upward move away from the bottom is the operator's. jsdom cannot
 * scroll, so the metrics are set by hand and the scroll event dispatched.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    regenerate: async () => {},
    setMessages: () => {},
    liveContextBlocks: null,
    lastTraceId: null,
  }),
}));
vi.mock("@/features/chat-v2/hooks/use-tts", () => ({ useTts: () => ({ supported: false }) }));
vi.mock("@/features/chat-v2/hooks/use-chat-deep-link-prefill", () => ({ useChatDeepLinkPrefill: () => {} }));
vi.mock("@/hooks/use-conversations", () => ({
  useConversations: () => ({ convos: [], activeId: null, pinnedIds: new Set(), isLoadingConvo: false }),
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

let host: HTMLDivElement;
let root: Root;
let scroller: HTMLElement;
// Follow scrolls the container itself. scrollIntoView would also scroll the
// overflow:hidden ancestors and leave a dark band under the messages.
const scrollIntoView = vi.fn();
const containerScrollTo = vi.fn();

function setMetrics(scrollTop: number, scrollHeight = 2000, clientHeight = 500) {
  Object.defineProperty(scroller, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(scroller, "scrollTop", { value: scrollTop, configurable: true, writable: true });
}
function scrollTo(scrollTop: number, scrollHeight?: number) {
  setMetrics(scrollTop, scrollHeight);
  act(() => void scroller.dispatchEvent(new Event("scroll")));
}
async function contentGrows() {
  await act(async () => {
    scroller.appendChild(document.createElement("p"));
    await Promise.resolve();
  });
}
const jumpButton = () => host.querySelector('button[aria-label="Scroll to latest message"]');

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Element.prototype.scrollIntoView = scrollIntoView;
  Element.prototype.scrollTo = containerScrollTo;
  scrollIntoView.mockClear();
  containerScrollTo.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<ChatIsland />));
  scroller = host.querySelector('[class="flex-1 overflow-y-auto"]') as HTMLElement;
  scrollTo(1500); // at the bottom: following
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("auto-follow on scroll events alone", () => {
  it("an upward flick with no wheel or touch stops following and shows the jump button", async () => {
    scrollTo(700);
    expect(jumpButton(), "far from the bottom: the jump button must show").not.toBeNull();
    await contentGrows();
    expect(containerScrollTo, "new content must not yank the view back down").not.toHaveBeenCalled();
    expect(scrollIntoView, "no ancestor scroll").not.toHaveBeenCalled();
  });

  it("CONTROL: follow's own downward scroll, still far from the bottom, keeps following", async () => {
    scrollTo(1500, 2600); // content grew by 600px; the view has not moved yet
    scrollTo(1800, 2600); // follow scrolling down toward the new bottom
    expect(jumpButton()).toBeNull();
    await contentGrows();
    expect(containerScrollTo).toHaveBeenCalled();
    expect(scrollIntoView, "no ancestor scroll").not.toHaveBeenCalled();
  });

  it("CONTROL: a small upward move inside the bottom band keeps following", async () => {
    scrollTo(1420);
    expect(jumpButton()).toBeNull();
    await contentGrows();
    expect(containerScrollTo).toHaveBeenCalled();
    expect(scrollIntoView, "no ancestor scroll").not.toHaveBeenCalled();
  });
});
