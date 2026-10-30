/**
 * tests/components/chat-island-header.test.tsx - audit 09-F22 + 09-F23, task R3-05.
 *
 * The header carried a dead "auto posture - auto depth" strip (the selectors
 * were removed from the composer on 2026-08-28), and the auto-read preference
 * was a per-reply button repeated on every assistant turn. The header now owns
 * the one auto-read control. Rendered, with the streaming stack stubbed.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A client mount: zustand v5 hands renderToStaticMarkup the store's initial state. */
function mount(el: React.ReactElement): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(el));
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

const h = vi.hoisted(() => ({ tts: {} as Record<string, unknown> }));

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
vi.mock("@/features/chat-v2/hooks/use-tts", () => ({ useTts: () => h.tts }));
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
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const tts = (over: Record<string, unknown>) => ({
  supported: true,
  enabled: false,
  toggle: () => {},
  narrating: false,
  speakingMessageId: null,
  speakMessage: () => {},
  stop: () => {},
  narratingEngine: null,
  rate: 1,
  cycleRate: () => {},
  ...over,
});

beforeEach(() => {
  useChatUiStore.setState({ privateMode: false, historyDrawerOpen: false });
});

describe("chat-island header", () => {
  it("renders exactly one auto-read control, with its state", () => {
    h.tts = tts({ enabled: true });
    const markup = mount(<ChatIsland />);
    expect(markup.split("Auto-read replies").length - 1).toBe(1);
    expect(markup).toMatch(/aria-label="Auto-read replies is on \(tap to turn off\)" aria-pressed="true"/);

    h.tts = tts({ enabled: false });
    expect(mount(<ChatIsland />)).toMatch(
      /aria-label="Auto-read replies is off \(tap to turn on\)" aria-pressed="false"/,
    );
  });

  it("no speech engine, no auto-read control (a dead control looks alive)", () => {
    h.tts = tts({ supported: false });
    expect(mount(<ChatIsland />)).not.toContain("Auto-read replies");
  });

  it("drops the dead posture and depth strip, keeps the Private marker (sentence case since W3b)", () => {
    h.tts = tts({});
    const plain = mount(<ChatIsland />);
    expect(plain).not.toMatch(/auto posture|auto depth/);
    expect(plain).not.toContain("Private");
    useChatUiStore.setState({ privateMode: true });
    const marked = mount(<ChatIsland />);
    expect(marked).toContain("Private");
    expect(marked).not.toContain("PRIVATE");
  });
});

// W3b: one header line. The title is "Nick" in sentence case; below md only History and More are
// visible and the other controls sit inside More; at md and up all of them stay in the header.
describe("chat-island header, W3b composition", () => {
  it("titles the page Nick in sentence case", () => {
    h.tts = tts({});
    const markup = mount(<ChatIsland />);
    expect(markup).toMatch(/<h1[^>]*>Nick<\/h1>/);
    expect(markup).not.toMatch(/>NICK</);
  });

  it("hides auto-read, context and voice below md and shows a More control there; History stays", () => {
    h.tts = tts({});
    const markup = mount(<ChatIsland />);
    const button = (label: string) => markup.match(new RegExp(`<button[^>]*aria-label="${label}[^"]*"[^>]*>`))?.[0] ?? "";
    expect(button("Auto-read replies")).toContain("max-md:hidden");
    expect(button("Context and memory")).toContain("max-md:hidden");
    expect(button("Start voice typing")).toContain("max-md:hidden");
    expect(button("Conversation history")).not.toContain("max-md:hidden");
    expect(button("More chat controls")).toContain("md:hidden");
    expect(button("More chat controls")).not.toContain("max-md:hidden");
  });

  it("More opens an in-DOM sheet holding the three controls (no native menu)", () => {
    h.tts = tts({});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ChatIsland />));
    const more = container.querySelector('button[aria-label="More chat controls"]') as HTMLButtonElement;
    expect(more).not.toBeNull();
    act(() => more.click());
    const text = document.body.textContent ?? "";
    expect(text).toContain("Auto-read replies");
    expect(text).toContain("Context and memory");
    expect(text).toContain("Voice");
    act(() => root.unmount());
    container.remove();
  });
});
