/**
 * useConversations.readSavedTurn is what Retry reads after a stream error. It must
 * hit the server every time and leave nothing behind: an errored row is settled only
 * after its stream ends, so any cached copy (the React Query cache keeps a fetched
 * conversation, and the app's default staleTime would serve it back) reads "not
 * settled" or "no row yet" long after it stopped being true. It uses the vanilla
 * tRPC client, which has no cache, and hands back the conversation's rows exactly as
 * saved. The caller's AbortSignal reaches the request, so a read that is given up
 * on is cancelled instead of left running.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  conversationQuery: vi.fn(),
  cachedFetch: vi.fn(),
}));

vi.mock("@/lib/trpc/vanilla-client", () => ({
  trpcVanilla: { chat: { conversation: { query: (...args: unknown[]) => h.conversationQuery(...args) } } },
}));

vi.mock("@/lib/trpc/client", () => {
  const useMutation = () => ({ mutateAsync: vi.fn(), mutate: vi.fn() });
  const utils = {
    chat: {
      list: { fetch: vi.fn(async () => ({ conversations: [], hasMore: false, nextCursor: null })) },
      // the React Query path: caches what it fetches. Retry's read must not use it.
      conversation: { fetch: (...args: unknown[]) => h.cachedFetch(...args) },
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
  return { read: (id: string, signal?: AbortSignal) => api.readSavedTurn(id, signal), unmount: () => act(() => root.unmount()) };
}

describe("useConversations.readSavedTurn", () => {
  it("asks the server directly, with no cache in between, and returns the saved rows oldest first", async () => {
    const messages = [
      { id: "u1", role: "user", content: "add a task" },
      { id: "a1", role: "assistant", content: "Working on it", streamingState: "errored", tokenUsage: { traceId: "T1", toolReceipts: [] } },
    ];
    h.conversationQuery.mockResolvedValue({ id: "c1", messages });
    const { read, unmount } = mountHook();

    const rows = await read("c1");

    expect(h.conversationQuery).toHaveBeenCalledWith({ id: "c1" }, { signal: undefined });
    expect(h.cachedFetch, "the React Query path would keep the fetched conversation cached").not.toHaveBeenCalled();
    expect(rows).toBe(messages);
    unmount();
  });

  it("hands the caller's AbortSignal to the request", async () => {
    h.conversationQuery.mockResolvedValue({ id: "c1", messages: [] });
    const { read, unmount } = mountHook();
    const controller = new AbortController();

    await read("c1", controller.signal);

    expect(h.conversationQuery).toHaveBeenLastCalledWith({ id: "c1" }, { signal: controller.signal });
    unmount();
  });

  it("a failed read rejects, so the hook's caller can hold Retry instead of guessing", async () => {
    h.conversationQuery.mockRejectedValue(new Error("NOT_FOUND"));
    const { read, unmount } = mountHook();

    await expect(read("gone")).rejects.toThrow("NOT_FOUND");
    unmount();
  });
});
