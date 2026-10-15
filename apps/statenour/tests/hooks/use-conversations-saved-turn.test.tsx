/**
 * useConversations.readSavedTurn is what Retry reads after a stream error. It must
 * hit the server every time (staleTime 0: an errored row is settled only after its
 * stream ends, so a cached copy from before would read "not settled" forever) and
 * hand back the conversation's rows exactly as saved.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  conversationFetch: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => {
  const useMutation = () => ({ mutateAsync: vi.fn(), mutate: vi.fn() });
  const utils = {
    chat: {
      list: { fetch: vi.fn(async () => ({ conversations: [], hasMore: false, nextCursor: null })) },
      conversation: { fetch: (...args: unknown[]) => h.conversationFetch(...args) },
    },
  };
  return {
    trpc: {
      useUtils: () => utils,
      chat: {
        deleteConversation: { useMutation },
        updateConversation: { useMutation },
        renameConversation: { useMutation },
      },
    },
  };
});

import { useConversations } from "@/hooks/use-conversations";

function mountHook() {
  let api!: ReturnType<typeof useConversations>;
  function Probe() {
    api = useConversations({ setMessages: () => {}, onError: () => {} });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return { read: (id: string) => api.readSavedTurn(id), unmount: () => act(() => root.unmount()) };
}

describe("useConversations.readSavedTurn", () => {
  it("asks the server for the conversation with no caching, and returns the saved rows oldest first", async () => {
    const messages = [
      { id: "u1", role: "user", content: "add a task" },
      { id: "a1", role: "assistant", content: "Working on it", streamingState: "errored", tokenUsage: { toolReceipts: [] } },
    ];
    h.conversationFetch.mockResolvedValue({ id: "c1", messages });
    const { read, unmount } = mountHook();

    const rows = await read("c1");

    expect(h.conversationFetch).toHaveBeenCalledWith({ id: "c1" }, { staleTime: 0 });
    expect(rows).toBe(messages);
    unmount();
  });

  it("a failed read rejects, so the hook's caller can hold Retry instead of guessing", async () => {
    h.conversationFetch.mockRejectedValue(new Error("NOT_FOUND"));
    const { read, unmount } = mountHook();

    await expect(read("gone")).rejects.toThrow("NOT_FOUND");
    unmount();
  });
});
