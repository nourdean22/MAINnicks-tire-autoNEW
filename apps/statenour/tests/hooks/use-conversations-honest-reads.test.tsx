/**
 * UI v3 W3b: the History reads say what happened (empty-vs-error).
 *
 * Before this, `reloadConvos` ended in `.catch(() => {})` (a failed list read rendered as
 * "No conversations in this view."), `loadConvo` returned nothing (the island moved the store
 * before the rows arrived, so a failed open left the next send posting into a conversation the
 * operator never saw), and a failed Load older was silent. Now the list read carries a state,
 * `loadConvo` answers whether the rows landed (only the latest request may answer true), and
 * every failed write reaches `onError`.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  listFetch: vi.fn(),
  conversationFetch: vi.fn(),
}));

vi.mock("@/lib/trpc/vanilla-client", () => ({
  trpcVanilla: { chat: { conversation: { query: vi.fn() } } },
}));

vi.mock("@/lib/trpc/client", () => {
  const useMutation = () => ({ mutateAsync: vi.fn(), mutate: vi.fn() });
  const utils = {
    chat: {
      list: { fetch: (...args: unknown[]) => h.listFetch(...args) },
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

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function mountHook(onError = vi.fn()) {
  let api!: ReturnType<typeof useConversations>;
  function Probe() {
    api = useConversations({ setMessages: () => {}, onError });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return { get api() { return api; }, onError, unmount: () => act(() => root.unmount()) };
}

const okList = { conversations: [{ id: "c1", title: "One", createdAt: "2026-10-16T00:00:00.000Z", _count: { messages: 2 } }], hasMore: false, nextCursor: null };

beforeEach(() => {
  h.listFetch.mockReset();
  h.conversationFetch.mockReset();
});

describe("the conversation list read has three states", () => {
  it("in flight: loading, never 'empty'", async () => {
    h.listFetch.mockReturnValue(new Promise(() => {}));
    const hook = mountHook();
    expect(hook.api.listState).toBe("loading");
    hook.unmount();
  });

  it("a failed read is 'error', and Retry reads again", async () => {
    h.listFetch.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(okList);
    const hook = mountHook();
    await flush();
    expect(hook.api.listState).toBe("error");
    expect(hook.api.convos).toEqual([]);

    act(() => hook.api.reloadConvos());
    await flush();
    expect(hook.api.listState).toBe("ok");
    expect(hook.api.convos.map((c) => c.id)).toEqual(["c1"]);
    hook.unmount();
  });

  it("CONTROL: a read that returns no rows is 'ok' with an empty list (a measured zero)", async () => {
    h.listFetch.mockResolvedValue({ conversations: [], hasMore: false, nextCursor: null });
    const hook = mountHook();
    await flush();
    expect(hook.api.listState).toBe("ok");
    expect(hook.api.convos).toEqual([]);
    hook.unmount();
  });
});

describe("loadConvo answers whether the rows landed", () => {
  it("resolves true and clears loadFailedId when the conversation arrives", async () => {
    h.listFetch.mockResolvedValue(okList);
    h.conversationFetch.mockResolvedValue({ id: "c1", messages: [{ id: "m1", role: "user", content: "hi" }] });
    const hook = mountHook();
    let ok: boolean | undefined;
    await act(async () => { ok = await hook.api.loadConvo("c1"); });
    expect(ok).toBe(true);
    expect(hook.api.loadFailedId).toBeNull();
    expect(hook.api.activeId).toBe("c1");
    hook.unmount();
  });

  it("resolves false and names the conversation that failed, so the island can offer Retry and never move the store", async () => {
    h.listFetch.mockResolvedValue(okList);
    h.conversationFetch.mockRejectedValue(new Error("NOT_FOUND"));
    const hook = mountHook();
    let ok: boolean | undefined;
    await act(async () => { ok = await hook.api.loadConvo("c9"); });
    expect(ok).toBe(false);
    expect(hook.api.loadFailedId).toBe("c9");
    expect(hook.api.activeId).toBeNull();
    hook.unmount();
  });

  it("a load superseded by a later pick answers false even when its rows arrive (only the latest request may move the store)", async () => {
    h.listFetch.mockResolvedValue(okList);
    let resolveFirst!: (v: unknown) => void;
    h.conversationFetch
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ id: "c2", messages: [] });
    const hook = mountHook();
    let first: Promise<boolean>;
    let second: boolean | undefined;
    await act(async () => {
      first = hook.api.loadConvo("c1");
      second = await hook.api.loadConvo("c2");
    });
    expect(second).toBe(true);
    let firstResult: boolean | undefined;
    await act(async () => {
      resolveFirst({ id: "c1", messages: [] });
      firstResult = await first;
    });
    expect(firstResult).toBe(false);
    expect(hook.api.activeId).toBe("c2");
    hook.unmount();
  });

  it("a new chat clears a recorded load failure", async () => {
    h.listFetch.mockResolvedValue(okList);
    h.conversationFetch.mockRejectedValue(new Error("NOT_FOUND"));
    const hook = mountHook();
    await act(async () => { await hook.api.loadConvo("c9"); });
    expect(hook.api.loadFailedId).toBe("c9");
    act(() => hook.api.newChat());
    expect(hook.api.loadFailedId).toBeNull();
    hook.unmount();
  });
});

describe("a failed Load older is said, not swallowed", () => {
  it("calls onError with one line", async () => {
    h.listFetch.mockResolvedValueOnce({ ...okList, hasMore: true, nextCursor: "cur" }).mockRejectedValueOnce(new Error("boom"));
    const hook = mountHook();
    await flush();
    expect(hook.api.hasMoreConvos).toBe(true);
    await act(async () => { await hook.api.loadMoreConvos(); });
    expect(hook.onError).toHaveBeenCalledWith("Couldn't load older conversations.");
    expect(hook.api.convos.map((c) => c.id)).toEqual(["c1"]);
    hook.unmount();
  });
});
