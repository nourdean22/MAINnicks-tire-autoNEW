// @vitest-environment jsdom
/**
 * tests/components/chat-composer-glue.test.tsx · task P2-B6 items 5 and 7.
 *
 * Mounted for real (react-dom/client in jsdom), so effects, subscriptions and
 * clicks run; a static render shows none of them.
 *
 *   · Item 5: useCoarsePointer handed useSyncExternalStore a new inline
 *     subscribe on every render, and React re-subscribes whenever that
 *     function changes: one matchMedia listener torn down and re-added per
 *     keystroke. The subscribe must be stable.
 *   · Item 7: the Stop button must reach chat.stopTurn (DELETE, then abort),
 *     not the bare chat.stop (abort only, the server never hears it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ui = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/features/chat-v2/stores/chat-ui-store", () => {
  const read = () =>
    new Proxy(ui.state, { get: (target, key) => (key in target ? target[key as string] : () => {}) });
  const useChatUiStore = Object.assign((selector: (s: unknown) => unknown) => selector(read()), { getState: read });
  return { useChatUiStore };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({}),
    brain: { createPin: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) } },
    chat: { deleteMessage: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) } },
  },
}));
vi.mock("@/hooks/use-draft-autosave", () => ({
  useDraftAutosave: () => ({ clearDraft: () => {}, restore: () => null }),
}));
vi.mock("@/hooks/use-mention-suggestions", () => ({
  useMentionSuggestions: () => ({
    show: false,
    filtered: [],
    onInputChange: () => {},
    close: () => {},
    expandMentions: (t: string) => t,
    expandMentionsAsync: async (t: string) => t,
  }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { ChatComposer } from "@/features/chat-v2/components/chat-composer";

const addListener = vi.fn();
const removeListener = vi.fn();
let container: HTMLDivElement;
let root: Root;

function chatController(over: Record<string, unknown> = {}) {
  return {
    status: "ready",
    isStreaming: false,
    messages: [],
    sendText: vi.fn(),
    append: vi.fn(),
    stop: vi.fn(),
    stopTurn: vi.fn(),
    setMessages: vi.fn(),
    ...over,
  } as never;
}

function render(chat: unknown) {
  act(() => root.render(<ChatComposer chat={chat as never} />));
}

beforeEach(() => {
  ui.state = { draft: "", editingMessageId: null, draftReplace: null, privateMode: false };
  addListener.mockClear();
  removeListener.mockClear();
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: addListener,
    removeEventListener: removeListener,
  })) as never;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("item 5 · the pointer query is subscribed once, not per render", () => {
  it("four renders, one matchMedia listener, never torn down in between", () => {
    render(chatController());
    for (const text of ["a", "ab", "abc"]) {
      ui.state.draft = text;
      render(chatController());
    }
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(removeListener).not.toHaveBeenCalled();
  });

  it("CONTROL: the listener is removed on unmount", () => {
    render(chatController());
    act(() => root.unmount());
    root = createRoot(container);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});

describe("item 7 · the Stop button reaches stopTurn", () => {
  it("a tap calls chat.stopTurn, not the bare abort", () => {
    const chat = chatController({ status: "streaming", isStreaming: true });
    render(chat);
    const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop generating"]');
    expect(stop).not.toBeNull();
    act(() => stop!.click());
    const c = chat as unknown as { stopTurn: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
    expect(c.stopTurn).toHaveBeenCalledTimes(1);
    expect(c.stop).not.toHaveBeenCalled();
  });

  it("CONTROL: no reply in flight, no Stop button", () => {
    render(chatController());
    expect(container.querySelector('button[aria-label="Stop generating"]')).toBeNull();
  });
});

// The /new slash action empties the chat and clears the active conversation from the composer. Like the
// drawer's New and delete-active, it must reset the old turn (error, trace refs, outstanding replay)
// BEFORE the active conversation moves, or they stay attached to the empty chat.
describe("the /new slash action resets the turn before the conversation is cleared", () => {
  function typeInto(textarea: HTMLTextAreaElement, value: string) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const startNewChat = async () => {
    const textarea = container.querySelector("textarea")!;
    typeInto(textarea, "/new");
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Start new chat"));
    expect(button, "the /new entry of the slash menu").toBeTruthy();
    await act(async () => void button!.click());
  };

  it("resetTurn runs first, stop and setMessages([]) still run, then the store move", async () => {
    const calls: string[] = [];
    ui.state.setActiveConversationId = vi.fn((id: unknown) => void calls.push(`store:${id}`));
    render(
      chatController({
        resetTurn: vi.fn(() => void calls.push("resetTurn")),
        stop: vi.fn(() => void calls.push("stop")),
        setMessages: vi.fn((messages: unknown) => void calls.push(`setMessages:${JSON.stringify(messages)}`)),
      }),
    );

    await startNewChat();

    expect(calls).toEqual(["resetTurn", "stop", "setMessages:[]", "store:null"]);
  });
});
