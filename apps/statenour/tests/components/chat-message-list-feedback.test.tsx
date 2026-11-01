// @vitest-environment jsdom
/**
 * tests/components/chat-message-list-feedback.test.tsx - audit 06-F9-N1, task R3-05.
 *
 * The action sheet has had thumbs since v10.0.515, but the chat-v2 rebuild
 * never passed onFeedback, so no client wrote feedbackScore. Mounted for real
 * (jsdom): More opens the sheet for one reply, and the sheet's thumbs reach
 * chat.messageFeedback. Only the sheet itself and the network edge are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "ai";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  sheet: {} as { role?: string; onFeedback?: (positive: boolean) => void },
  mutate: vi.fn(),
}));

vi.mock("@/components/chat/message-action-sheet", () => ({
  MessageActionSheet: (props: typeof h.sheet) => {
    h.sheet = props;
    return null;
  },
}));
vi.mock("@/lib/trpc/vanilla-client", () => ({
  trpcVanilla: { chat: { messageFeedback: { mutate: h.mutate } } },
}));
vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = { useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }) };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  return { trpc: new Proxy({}, { get: (_t, prop) => (prop === "useUtils" ? () => ({}) : procProxy) }) };
});
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => <a href={String(href)}>{children}</a>,
}));
vi.mock("@/hooks/chat/use-lazy-render-messages", () => ({
  useLazyRenderMessages: (messages: UIMessage[]) => ({ renderedMessages: messages, hasHidden: false, hiddenCount: 0, showOlder: () => {} }),
}));
vi.mock("@/components/chat/nick-message", () => ({ NickMessage: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("@/components/chat/message-bubble-shells", () => ({
  UserMessageBubble: ({ text }: { text: string }) => <div>{text}</div>,
  AssistantMessageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/chat/tool-result-card", () => ({ ToolResultCard: () => null, isKnownToolName: () => false }));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));
vi.mock("@/features/chat-v2/components/media-timestamp-bar", () => ({ MediaTimestampBar: () => null }));

import { toast } from "sonner";
import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const thread = [
  { id: "u0", role: "user", parts: [{ type: "text", text: "first" }] },
  { id: "a0", role: "assistant", parts: [{ type: "text", text: "older reply" }] },
  { id: "u1", role: "user", parts: [{ type: "text", text: "second" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "latest reply" }] },
] as unknown as UIMessage[];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.mutate.mockReset().mockResolvedValue({ ok: true });
  h.sheet = {};
  vi.mocked(toast.error).mockClear();
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<ChatMessageList messages={thread} isLoading={false} error={undefined} conversationId="c1" />));
});

afterEach(() => {
  act(() => root.unmount());
  useChatUiStore.setState({ privateMode: false });
});

/** More on the n-th turn (0-based) opens the sheet for that message. */
function openMore(turn: number) {
  const buttons = container.querySelectorAll<HTMLButtonElement>('button[aria-label="More actions"]');
  act(() => buttons[turn].click());
}

describe("thumbs in the action sheet", () => {
  it("the latest reply's thumbs-up records score 1 with the conversation id", async () => {
    openMore(3);
    expect(h.sheet.role).toBe("assistant");
    expect(h.sheet.onFeedback).toBeTypeOf("function");
    await act(async () => h.sheet.onFeedback!(true));
    expect(h.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "a1", score: 1, conversationId: "c1" }),
    );
  });

  it("an older reply sends no conversation id (the server would fall back to the latest reply)", async () => {
    openMore(1);
    await act(async () => h.sheet.onFeedback!(false));
    expect(h.mutate).toHaveBeenCalledWith(expect.objectContaining({ messageId: "a0", score: -1 }));
    expect(h.mutate.mock.calls[0][0].conversationId).toBeUndefined();
  });

  it("a failed save says so", async () => {
    h.mutate.mockRejectedValue(new Error("NOT_FOUND"));
    openMore(3);
    await act(async () => h.sheet.onFeedback!(true));
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: the operator's own message gets no thumbs", () => {
    openMore(2);
    expect(h.sheet.role).toBe("user");
    expect(h.sheet.onFeedback).toBeUndefined();
  });

  // R3-15 (review finding 7): a reply still streaming has no row yet, so the
  // server's newest-row fallback would score the PREVIOUS reply.
  // 2026-10-29: the long-press sheet is gone (a hold is iOS text selection), so
  // More is the only way into the sheet, and the streaming reply has none.
  describe("while the latest reply streams", () => {
    const streaming = () =>
      act(() => root.render(<ChatMessageList messages={thread} isLoading error={undefined} conversationId="c1" />));

    it("it has no More button, so no sheet and no thumbs", () => {
      streaming();
      const more = container.querySelectorAll('button[aria-label="More actions"]');
      expect(more).toHaveLength(3); // u0, a0, u1; the streaming a1 has none
    });

    it("CONTROL: an older reply keeps its thumbs", () => {
      streaming();
      openMore(1);
      expect(h.sheet.role).toBe("assistant");
      expect(h.sheet.onFeedback).toBeTypeOf("function");
    });
  });

  it("Private Lab offers no thumbs (nothing there may persist)", () => {
    act(() => useChatUiStore.setState({ privateMode: true }));
    openMore(3);
    expect(h.sheet.onFeedback).toBeUndefined();
  });
});
