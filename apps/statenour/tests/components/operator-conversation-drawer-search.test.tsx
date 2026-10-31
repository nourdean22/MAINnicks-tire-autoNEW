// @vitest-environment jsdom
/**
 * U6b (2026-10-31) · the history drawer searches what was SAID, not only titles.
 *
 * Before: the search box filtered the loaded titles in the browser, and the server's full-text
 * chat.search had no caller, so a thread was findable only by its auto-title. Now 3+ characters
 * also run chat.search (debounced 300 ms) and list the matching conversations with a snippet; a
 * failed search says so (never "no matches"), and a slow answer for an older query never shows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { OperatorConversationDrawer } from "@/features/chat-v2/components/operator-conversation-drawer";

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.useRealTimers(); });

const group = (id: string, title: string) => ({ conversationId: id, conversationTitle: title, totalMatches: 2, snippets: [{ snippet: `snippet ${id}` }] });
function render(onSearchMessages?: (q: string) => Promise<{ results: ReturnType<typeof group>[] }>, onSelect = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(
    <OperatorConversationDrawer
      convos={[]} activeId={null} pinnedIds={new Set()} hasMore={false} loadingMore={false} listState="ok"
      onRetryList={vi.fn()} onLoadMore={vi.fn()} onSelect={onSelect} onDelete={vi.fn()} onRename={vi.fn()} onTogglePin={vi.fn()}
      onArchive={vi.fn()} archivedConvos={null} onLoadArchived={vi.fn()} onUnarchive={vi.fn()} onNew={vi.fn()} onShowActions={vi.fn()} onClose={vi.fn()}
      onSearchMessages={onSearchMessages}
    />,
  ));
  return { onSelect };
}
function type(text: string) {
  const input = host.querySelector('input[placeholder="Search conversations"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const settle = () => act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); await Promise.resolve(); });

describe("history drawer · message search (U6b)", () => {
  it("3+ characters search the messages and list the matching conversations", async () => {
    const search = vi.fn(async () => ({ results: [group("c9", "Brake job")] }));
    const { onSelect } = render(search);
    type("brake");
    await settle();
    expect(search).toHaveBeenCalledWith("brake");
    expect(host.textContent).toContain("In messages (1)");
    expect(host.textContent).toContain("snippet c9");
    act(() => (Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Brake job")) as HTMLButtonElement).click());
    expect(onSelect).toHaveBeenCalledWith("c9");
  });

  it("a failed search says it failed, never 'no matches'", async () => {
    render(vi.fn(async () => { throw new Error("db"); }));
    type("brake");
    await settle();
    expect(host.textContent).toContain("Message search failed");
    expect(host.textContent).not.toContain("No messages match");
  });

  it("a slow answer for an older query never shows under a newer one", async () => {
    let releaseOld!: (v: { results: ReturnType<typeof group>[] }) => void;
    const search = vi.fn((q: string) => (q === "bra" ? new Promise<{ results: ReturnType<typeof group>[] }>((r) => { releaseOld = r; }) : Promise.resolve({ results: [group("new", "New one")] })));
    render(search);
    type("bra");
    await settle();
    type("brake");
    await settle();
    await act(async () => { releaseOld({ results: [group("old", "Old one")] }); await Promise.resolve(); });
    expect(host.textContent).toContain("New one");
    expect(host.textContent).not.toContain("Old one");
  });

  it("CONTROL: under 3 characters nothing is sent", async () => {
    const search = vi.fn(async () => ({ results: [] }));
    render(search);
    type("br");
    await settle();
    expect(search).not.toHaveBeenCalled();
  });
});
