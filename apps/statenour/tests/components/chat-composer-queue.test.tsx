/**
 * W2 (2026-10-30) · messages typed while Nick is still replying.
 *
 * Nour: "queue messages in the chat too even while its still working". Before, Enter during a reply
 * showed "Nick is still replying. Stop the reply to send this." and dropped nothing into a queue.
 * Now the message waits, one goes out per finished reply (Stop counts), it survives a reload, it is
 * removed from storage before it is sent (never twice), and it stays with the chat it was typed in.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toastFn = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(toastFn, { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
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

import { ChatComposer } from "@/features/chat-v2/components/chat-composer";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const KEY = "nick-chat-queue";
const sendText = vi.fn();
let root: Root | null = null;
let host: HTMLDivElement;

function chat(state: boolean | "error") {
  const isStreaming = state === true;
  return {
    status: state === "error" ? "error" : isStreaming ? "streaming" : "ready",
    error: state === "error" ? new Error("network") : undefined,
    isStreaming,
    messages: [],
    sendText,
    append: vi.fn(),
    setMessages: vi.fn(),
    stopTurn: vi.fn(),
  } as any;
}
function render(state: boolean | "error") {
  act(() => root!.render(<ChatComposer chat={chat(state)} />));
}
function mount(isStreaming: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  render(isStreaming);
}
async function typeAndEnter(text: string) {
  act(() => useChatUiStore.setState({ draft: text }));
  const box = host.querySelector("textarea[data-chat-composer-input]") as HTMLTextAreaElement;
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as Array<{ text: string; conversationId: string | null }>;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  localStorage.clear();
  sendText.mockClear();
  toastFn.mockClear();
  useChatUiStore.setState({ draft: "", activeConversationId: "c1", editingMessageId: null } as never);
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe("chat composer message queue", () => {
  it("Enter during a reply queues the message: nothing sent, draft cleared, shown as Sends next", async () => {
    mount(true);
    await typeAndEnter("also check the brakes");

    expect(sendText).not.toHaveBeenCalled();
    expect(stored().map((q) => q.text)).toEqual(["also check the brakes"]);
    expect(useChatUiStore.getState().draft).toBe("");
    expect(host.textContent).toContain("Sends next");
    expect(host.textContent).toContain("also check the brakes");
    expect(toastFn).not.toHaveBeenCalledWith(expect.stringContaining("Stop the reply"), expect.anything());
  });

  it("one queued message goes out per finished reply, in order, and never twice", async () => {
    mount(true);
    await typeAndEnter("first");
    await typeAndEnter("second");

    render(false); // reply ended (or Stop)
    await flush();
    expect(sendText.mock.calls.map((c) => c[0])).toEqual(["first"]);
    expect(stored().map((q) => q.text)).toEqual(["second"]);

    render(false); // still idle: no reply ended, nothing more goes
    await flush();
    expect(sendText).toHaveBeenCalledTimes(1);

    render(true);
    render(false); // the next reply ended
    await flush();
    expect(sendText.mock.calls.map((c) => c[0])).toEqual(["first", "second"]);
    expect(stored()).toEqual([]);
  });

  it("survives a reload without auto-sending: it shows, and its Send sends it once", async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: "q1", text: "from before the reload", conversationId: "c1" }]));
    mount(false);
    await flush();
    expect(sendText).not.toHaveBeenCalled();
    expect(host.textContent).toContain("from before the reload");

    const send = host.querySelector('button[aria-label^="Send now"]') as HTMLButtonElement;
    await act(async () => { send.click(); });
    await flush();
    expect(sendText.mock.calls.map((c) => c[0])).toEqual(["from before the reload"]);
    expect(stored()).toEqual([]);
  });

  it("a reply that ERRORS holds the queue; the next clean finish sends", async () => {
    mount(true);
    await typeAndEnter("hold me");
    render("error");
    await flush();
    expect(sendText).not.toHaveBeenCalled();
    expect(stored().map((q) => q.text)).toEqual(["hold me"]);

    render(true);
    render(false);
    await flush();
    expect(sendText.mock.calls.map((c) => c[0])).toEqual(["hold me"]);
  });

  it("sending a queued message keeps what the operator is typing", async () => {
    mount(true);
    await typeAndEnter("queued one");
    act(() => useChatUiStore.setState({ draft: "half typed" }));
    render(false);
    await flush();
    expect(sendText.mock.calls.map((c) => c[0])).toEqual(["queued one"]);
    expect(useChatUiStore.getState().draft).toBe("half typed");
  });

  it("an armed edit holds the queue until it is resolved, then the queued message sends", async () => {
    mount(true);
    await typeAndEnter("after the edit");
    act(() => useChatUiStore.setState({ editingMessageId: "m1" } as never));
    render(false);
    await flush();
    expect(sendText).not.toHaveBeenCalled();

    act(() => useChatUiStore.setState({ editingMessageId: null } as never));
    await flush();
    expect(sendText.mock.calls.map((c) => c[0])).toEqual(["after the edit"]);
  });

  it("a message typed in a new chat moves with it when the chat gets an id", async () => {
    useChatUiStore.setState({ activeConversationId: null } as never);
    mount(true);
    await typeAndEnter("new chat question");
    expect(stored()[0].conversationId).toBeNull();
    act(() => useChatUiStore.setState({ activeConversationId: "c9" } as never));
    await flush();
    expect(stored()[0].conversationId).toBe("c9");
  });

  it("stays with its chat: another chat's message is neither shown nor sent", async () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: "q1", text: "for the other chat", conversationId: "c2" }]));
    mount(false);
    await flush();
    expect(sendText).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("for the other chat");
    expect(stored()).toHaveLength(1);
  });

  it("Edit moves a waiting message back into the draft; Remove drops it", async () => {
    mount(true);
    await typeAndEnter("edit me");
    await typeAndEnter("drop me");

    const edit = [...host.querySelectorAll("button")].find((b) => b.textContent === "Edit") as HTMLButtonElement;
    await act(async () => { edit.click(); });
    expect(useChatUiStore.getState().draft).toBe("edit me");
    expect(stored().map((q) => q.text)).toEqual(["drop me"]);

    const remove = host.querySelector('button[aria-label^="Remove from queue"]') as HTMLButtonElement;
    await act(async () => { remove.click(); });
    expect(stored()).toEqual([]);
    expect(host.querySelector('ul[aria-label="Waiting to send"]')).toBeNull();
  });

  it("CONTROL: Enter while idle sends right away and queues nothing", async () => {
    mount(false);
    await typeAndEnter("plain send");
    await flush();
    expect(sendText.mock.calls.map((c) => c[0])).toEqual(["plain send"]);
    expect(stored()).toEqual([]);
  });
});
