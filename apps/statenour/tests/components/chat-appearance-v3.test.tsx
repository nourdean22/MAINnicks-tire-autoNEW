/**
 * tests/components/chat-appearance-v3.test.tsx - bdnick appearance wave B (2026-10-23).
 *
 * Chat obeys the Command Deck system (docs/design/ui-v2/SYSTEM.md section 11): real blur
 * (.ui-material) is for the spine, tab bar, composer shell, palette, popovers and inspector dock, and
 * nothing that is read. The bottom stack of Chat had drifted to three to five blurred layers: the media
 * dock and the jump-to-latest button were two of them. This renders the island with both on screen and
 * counts the blurred nodes it owns. A zero is only evidence when the two nodes are proven present, so
 * every count sits beside the positive controls that locate them.
 *
 * The Context control is a word, not the Brain glyph (antislop R-04: a generic AI icon).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
vi.mock("@/features/chat-v2/components/chat-media-focus-panel", () => ({ ChatMediaFocusPanel: () => null }));
vi.mock("@/features/chat-v2/components/chat-message-list", () => ({ ChatMessageList: () => null }));
vi.mock("@/features/chat-v2/components/chat-capability-indicator", () => ({ ChatCapabilityIndicator: () => null }));
vi.mock("@/features/chat-v2/components/operator-conversation-drawer", () => ({ OperatorConversationDrawer: () => null }));
vi.mock("@/components/chat/realtime-voice-overlay", () => ({ RealtimeVoiceOverlay: () => null }));
vi.mock("@/components/chat/memory-inspector-sidebar", () => ({ MemoryInspectorSidebar: () => null }));
// The REAL dock mounts (it is one of the two layers under test); its player and save control are stubbed.
vi.mock("@/features/chat-v2/components/chat-media-surface", () => ({ MediaPlayerSurface: () => <video /> }));
vi.mock("@/features/chat-v2/components/media-save-moment", () => ({ SaveMomentButton: () => null }));

import { ChatIsland } from "@/features/chat-v2/components/chat-island";
import { useMediaDockStore } from "@/features/chat-v2/stores/media-dock-store";

const APP = join(__dirname, "..", "..");
const source = (rel: string) => readFileSync(join(APP, rel), "utf8");

let host: HTMLDivElement;
let root: Root;

/** At the bottom first, then an upward move away from it: follow only yields to a move up (see chat-island-scroll-follow). */
function scrollAwayFromBottom() {
  const scroller = host.querySelector('[class="flex-1 overflow-y-auto"]') as HTMLElement;
  Object.defineProperty(scroller, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
  Object.defineProperty(scroller, "scrollTop", { value: 1500, configurable: true, writable: true });
  act(() => void scroller.dispatchEvent(new Event("scroll")));
  scroller.scrollTop = 700;
  act(() => void scroller.dispatchEvent(new Event("scroll")));
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  useMediaDockStore.setState({
    item: { id: "m1", url: "https://example.test/clip.mp4", kind: "video", title: "Fixture clip" },
    queue: [],
    focused: false,
    expanded: false,
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<ChatIsland />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useMediaDockStore.setState({ item: null, queue: [], focused: false, expanded: false });
  vi.unstubAllGlobals();
});

describe("Chat bottom stack: blur only on what SYSTEM.md section 11 lists", () => {
  it("POSITIVE CONTROL: the media dock and the jump-to-latest button are both on screen", () => {
    scrollAwayFromBottom();
    expect(host.querySelector('section[aria-label^="Media player"]'), "the real dock must mount").not.toBeNull();
    expect(host.querySelector('button[aria-label="Scroll to latest message"]'), "scrolled away: the jump button shows").not.toBeNull();
  });

  it("the island owns no .ui-material node: the dock and the jump button are solid", () => {
    scrollAwayFromBottom();
    const blurred = Array.from(host.querySelectorAll(".ui-material")).map(
      (n) => n.getAttribute("aria-label") ?? n.tagName.toLowerCase(),
    );
    expect(blurred).toEqual([]);
  });

  it("the layers that stay blurred are still blurred: the composer shell keeps its one .ui-material", () => {
    // The composer is stubbed above, so pin its source: exactly one blurred shell, none added by the sweep.
    const composer = source("features/chat-v2/components/chat-composer.tsx");
    expect((composer.match(/\bui-material\b/g) ?? []).length).toBe(1);
  });
});

describe("Chat header: Context is a word", () => {
  it("the Context control shows the word and no glyph", () => {
    const button = host.querySelector('button[aria-label="Context and memory"]') as HTMLButtonElement;
    expect(button, "the control exists (md and up)").not.toBeNull();
    expect(button.textContent?.trim()).toBe("Context");
    expect(button.querySelector("svg")).toBeNull();
    expect(button.querySelector(".sr-only")).toBeNull();
  });

  it("the Context control keeps its 44 px box", () => {
    const button = host.querySelector('button[aria-label="Context and memory"]') as HTMLButtonElement;
    expect(button.className).toMatch(/\bh-11\b/);
    expect(button.className).toMatch(/\bmin-w-11\b/);
  });
});
