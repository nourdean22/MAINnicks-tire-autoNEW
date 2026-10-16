/**
 * The consumer end of the live Retry check. useChatStream asks a reader for the
 * saved turn before it replays after a stream error; the island has to hand it one
 * that really reaches useConversations (which owns the tRPC client). The hook is
 * created before useConversations, so the reader travels through a ref: this fails
 * if the ref is never assigned, or never read.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  hookOptions: undefined as undefined | { readSavedTurn?: (id: string, signal?: AbortSignal) => Promise<unknown> },
  readSavedTurn: undefined as undefined | ((id: string, signal?: AbortSignal) => Promise<unknown>),
  // the order of the calls the drawer's handlers make: the turn is reset first, then the conversation moves
  calls: [] as string[],
  resetTurn: undefined as unknown as () => void,
  loadConvo: undefined as unknown as (id: string) => Promise<void>,
  newChat: undefined as unknown as () => void,
  // useConversations: which conversation is active, and what deleting one answers
  activeId: null as string | null,
  deleteConvo: undefined as unknown as (id: string) => Promise<boolean>,
  drawer: undefined as undefined | { onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string, event?: unknown) => void },
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
      resetTurn: () => h.resetTurn(),
      setMessages: () => {},
      liveContextBlocks: null,
      lastTraceId: null,
    };
  },
}));
vi.mock("@/features/chat-v2/hooks/use-tts", () => ({ useTts: () => ({}) }));
vi.mock("@/features/chat-v2/hooks/use-chat-deep-link-prefill", () => ({ useChatDeepLinkPrefill: () => {} }));
vi.mock("@/hooks/use-conversations", () => ({
  useConversations: () => ({
    convos: [],
    activeId: h.activeId,
    pinnedIds: new Set(),
    isLoadingConvo: false,
    readSavedTurn: h.readSavedTurn,
    loadConvo: (id: string) => h.loadConvo(id),
    newChat: () => h.newChat(),
    deleteConvo: (id: string) => h.deleteConvo(id),
  }),
}));
// Render the dialog's children inline when it is open, so the drawer's handlers can be called.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (open ? <>{children}</> : null),
  DialogContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/chat-v2/components/chat-composer", () => ({ ChatComposer: () => null }));
vi.mock("@/features/chat-v2/components/chat-media-dock", () => ({ ChatMediaDock: () => null }));
vi.mock("@/features/chat-v2/components/chat-media-focus-panel", () => ({ ChatMediaFocusPanel: () => null }));
vi.mock("@/features/chat-v2/components/chat-message-list", () => ({ ChatMessageList: () => null }));
vi.mock("@/features/chat-v2/components/chat-capability-indicator", () => ({ ChatCapabilityIndicator: () => null }));
vi.mock("@/features/chat-v2/components/operator-conversation-drawer", () => ({
  OperatorConversationDrawer: (props: { onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string, event?: unknown) => void }) => {
    h.drawer = props;
    return null;
  },
}));
vi.mock("@/components/chat/realtime-voice-overlay", () => ({ RealtimeVoiceOverlay: () => null }));
vi.mock("@/components/chat/memory-inspector-sidebar", () => ({ MemoryInspectorSidebar: () => null }));

import { ChatIsland } from "@/features/chat-v2/components/chat-island";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ChatIsland />));
  return () => act(() => root.unmount());
}

let stopRecordingMoves: (() => void) | undefined;
beforeEach(() => {
  h.hookOptions = undefined;
  h.readSavedTurn = undefined;
  h.calls = [];
  h.drawer = undefined;
  h.resetTurn = () => void h.calls.push("resetTurn");
  // W3b: loadConvo answers whether the rows landed; the store moves only on true.
  h.loadConvo = async (id) => {
    h.calls.push(`loadConvo:${id}`);
    return true;
  };
  h.newChat = () => void h.calls.push("newChat");
  h.activeId = null;
  h.deleteConvo = async (id) => {
    h.calls.push(`deleteConvo:${id}`);
    return true;
  };
  useChatUiStore.setState({ historyDrawerOpen: false, activeConversationId: null });
  // the store move is part of the order the handlers promise, so it is recorded too
  stopRecordingMoves = useChatUiStore.subscribe((state, previous) => {
    if (state.activeConversationId !== previous.activeConversationId) h.calls.push(`store:${state.activeConversationId}`);
  });
});
afterEach(() => stopRecordingMoves?.());

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

// The old turn's error and trace refs must not follow the operator into another conversation.
// Only the operator's own switch resets them; the id a first message gets from the response
// header is the same turn and must not.
describe("the island resets the turn when the operator opens another conversation", () => {
  function mountWithDrawerOpen() {
    useChatUiStore.setState({ historyDrawerOpen: true });
    return mount();
  }

  // W3b: the store moves AFTER the rows landed (it used to move before the read, so a failed open
  // left the next send posting into a conversation the operator never saw). resetTurn still
  // comes first.
  it("picking a conversation resets the turn BEFORE the rows load, and the store moves once they landed", async () => {
    const unmount = mountWithDrawerOpen();

    await act(async () => void h.drawer!.onSelect("c2"));

    expect(h.calls).toEqual(["resetTurn", "loadConvo:c2", "store:c2"]);
    expect(useChatUiStore.getState().activeConversationId).toBe("c2");
    unmount();
  });

  it("a pick whose rows never land leaves the store where it was", async () => {
    h.loadConvo = async (id) => {
      h.calls.push(`loadConvo:${id}`);
      return false;
    };
    useChatUiStore.setState({ activeConversationId: "c1" });
    h.calls.length = 0;
    const unmount = mountWithDrawerOpen();

    await act(async () => void h.drawer!.onSelect("c2"));

    expect(h.calls).toEqual(["resetTurn", "loadConvo:c2"]);
    expect(useChatUiStore.getState().activeConversationId).toBe("c1");
    unmount();
  });

  it("starting a new chat resets the turn BEFORE the store is cleared and the chat is emptied", () => {
    useChatUiStore.setState({ activeConversationId: "c1" });
    h.calls.length = 0;
    const unmount = mountWithDrawerOpen();

    act(() => h.drawer!.onNew());

    expect(h.calls).toEqual(["resetTurn", "store:null", "newChat"]);
    expect(useChatUiStore.getState().activeConversationId).toBeNull();
    unmount();
  });

  // Deleting the conversation the operator is in empties it just as a new chat does: the old turn's
  // error and trace state must not stay attached to the empty chat.
  it("deleting the ACTIVE conversation resets the turn BEFORE the store is cleared, once the delete succeeded", async () => {
    h.activeId = "c1";
    useChatUiStore.setState({ activeConversationId: "c1" });
    h.calls.length = 0;
    const unmount = mountWithDrawerOpen();

    await act(async () => void h.drawer!.onDelete("c1"));

    expect(h.calls).toEqual(["deleteConvo:c1", "resetTurn", "store:null"]);
    expect(useChatUiStore.getState().activeConversationId).toBeNull();
    unmount();
  });

  it("deleting a conversation that is NOT active touches neither the turn nor the store", async () => {
    h.activeId = "c1";
    useChatUiStore.setState({ activeConversationId: "c1" });
    h.calls.length = 0;
    const unmount = mountWithDrawerOpen();

    await act(async () => void h.drawer!.onDelete("c9"));

    expect(h.calls).toEqual(["deleteConvo:c9"]);
    expect(useChatUiStore.getState().activeConversationId).toBe("c1");
    unmount();
  });

  it("a delete that fails leaves the turn and the store alone", async () => {
    h.activeId = "c1";
    h.deleteConvo = async (id) => {
      h.calls.push(`deleteConvo:${id}`);
      return false;
    };
    useChatUiStore.setState({ activeConversationId: "c1" });
    h.calls.length = 0;
    const unmount = mountWithDrawerOpen();

    await act(async () => void h.drawer!.onDelete("c1"));

    expect(h.calls).toEqual(["deleteConvo:c1"]);
    expect(useChatUiStore.getState().activeConversationId).toBe("c1");
    unmount();
  });

  it("CONTROL: the id a first message is given (the store changing on its own) does not reset the turn", () => {
    const unmount = mountWithDrawerOpen();

    act(() => useChatUiStore.getState().setActiveConversationId("c9"));

    expect(h.calls, "only the store move, no resetTurn").toEqual(["store:c9"]);
    unmount();
  });
});
