/**
 * U6 (2026-10-31) · conversation controls: pins on the server, Archived + Unarchive, archive Undo.
 *
 * Before: a pin lived in one browser's localStorage (pinned on the phone, absent on the desktop);
 * archived conversations had no way back (the list filtered them out and nothing listed them);
 * archive was one tap with no undo. Now a pin is the row's starredAt, old local pins move up
 * once, the Archived tab reads archived rows, and Unarchive (also the toast's Undo) restores one;
 * an Undo inside the archive's 300 ms debounce cancels it before it reaches the server.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ listFetch: vi.fn(), update: vi.fn(async (_i: unknown) => ({})) }));

vi.mock("@/lib/trpc/vanilla-client", () => ({ trpcVanilla: { chat: { conversation: { query: vi.fn() } } } }));
vi.mock("@/lib/trpc/client", () => {
  const plain = () => ({ mutateAsync: vi.fn(), mutate: vi.fn() });
  const utils = { chat: { list: { fetch: (...a: unknown[]) => h.listFetch(...a) }, conversation: { fetch: vi.fn() } } };
  return {
    trpc: {
      useUtils: () => utils,
      chat: {
        deleteConversation: { useMutation: plain },
        updateConversation: { useMutation: () => ({ mutateAsync: h.update, mutate: vi.fn() }) },
        renameConversation: { useMutation: plain },
      },
    },
  };
});

import { useConversations } from "@/hooks/use-conversations";

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const row = (id: string, starredAt: string | null = null) => ({ id, title: id, createdAt: "2026-10-30T00:00:00.000Z", starredAt, _count: { messages: 1 } });

function mountHook() {
  let api!: ReturnType<typeof useConversations>;
  function Probe() {
    api = useConversations({ setMessages: () => {}, onError: vi.fn() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return { get api() { return api; }, unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  h.listFetch.mockReset();
  h.update.mockClear();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("pins live on the server (starredAt)", () => {
  it("a row starred on the server shows as pinned, and Pin writes starred to the server", async () => {
    h.listFetch.mockResolvedValue({ conversations: [row("a", "2026-10-30T01:00:00.000Z"), row("b")], hasMore: false, nextCursor: null });
    const hook = mountHook();
    await flush();
    expect([...hook.api.pinnedIds]).toEqual(["a"]);
    act(() => hook.api.togglePin("b"));
    expect(hook.api.pinnedIds.has("b")).toBe(true);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(h.update).toHaveBeenCalledWith({ id: "b", starred: true });
    hook.unmount();
  });

  it("a pin saved only in this browser is moved to the server once, then dropped from storage", async () => {
    localStorage.setItem("nour:pinned-convos", JSON.stringify(["b", "notLoadedYet"]));
    h.listFetch.mockResolvedValue({ conversations: [row("b")], hasMore: false, nextCursor: null });
    const hook = mountHook();
    await flush();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(h.update).toHaveBeenCalledWith({ id: "b", starred: true });
    expect(JSON.parse(localStorage.getItem("nour:pinned-convos") || "[]")).toEqual(["notLoadedYet"]);
    hook.unmount();
  });
});

describe("archived conversations come back", () => {
  it("the Archived read asks the server for archived rows", async () => {
    h.listFetch.mockResolvedValueOnce({ conversations: [row("a")], hasMore: false, nextCursor: null });
    h.listFetch.mockResolvedValueOnce({ conversations: [row("old")], hasMore: false, nextCursor: null });
    const hook = mountHook();
    await flush();
    await act(async () => { await hook.api.loadArchived(); });
    expect(h.listFetch).toHaveBeenLastCalledWith(expect.objectContaining({ archived: true }));
    expect(hook.api.archivedConvos?.map((c) => c.id)).toEqual(["old"]);
    hook.unmount();
  });

  it("Undo inside the archive's debounce cancels it: nothing reaches the server", async () => {
    h.listFetch.mockResolvedValue({ conversations: [row("a")], hasMore: false, nextCursor: null });
    const hook = mountHook();
    await flush();
    act(() => hook.api.patchConvoFlag("a", "archived", true));
    await act(async () => { await hook.api.unarchive("a"); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(h.update).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("Unarchive after the archive landed writes archived:false and reloads the list", async () => {
    h.listFetch.mockResolvedValue({ conversations: [row("a")], hasMore: false, nextCursor: null });
    const hook = mountHook();
    await flush();
    const before = h.listFetch.mock.calls.length;
    await act(async () => { await hook.api.unarchive("a"); });
    expect(h.update).toHaveBeenCalledWith({ id: "a", archived: false });
    expect(h.listFetch.mock.calls.length).toBeGreaterThan(before);
    hook.unmount();
  });
});
