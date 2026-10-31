// @vitest-environment jsdom
/**
 * U6 (2026-10-31) · the history drawer's Archived tab: it reads archived rows on open and each one
 * has Unarchive. Before, archived conversations had no way back from the app.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { OperatorConversationDrawer } from "@/features/chat-v2/components/operator-conversation-drawer";

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });

const row = (id: string) => ({ id, title: `T ${id}`, createdAt: "2026-10-30T00:00:00.000Z", _count: { messages: 1 } });
function render(props: Partial<React.ComponentProps<typeof OperatorConversationDrawer>>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const base: React.ComponentProps<typeof OperatorConversationDrawer> = {
    convos: [row("live")], activeId: null, pinnedIds: new Set(), hasMore: false, loadingMore: false, listState: "ok",
    onRetryList: vi.fn(), onLoadMore: vi.fn(), onSelect: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(), onTogglePin: vi.fn(),
    onArchive: vi.fn(), archivedConvos: null, onLoadArchived: vi.fn(), onUnarchive: vi.fn(), onNew: vi.fn(), onShowActions: vi.fn(), onClose: vi.fn(),
  };
  const all = { ...base, ...props };
  act(() => root!.render(<OperatorConversationDrawer {...all} />));
  return all;
}
const tab = (name: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim().toLowerCase() === name)!;

describe("history drawer · Archived tab (U6)", () => {
  it("opening Archived asks for the archived rows", () => {
    const p = render({});
    act(() => tab("archived").click());
    expect(p.onLoadArchived).toHaveBeenCalledTimes(1);
    // audit 002 #2: before the read lands the tab says it is loading (it used to say "not loaded").
    expect(host.textContent).toContain("Loading archived conversations…");
  });

  it("archived rows show with Unarchive, which hands back the id", () => {
    const p = render({ archivedConvos: [row("old")] });
    act(() => tab("archived").click());
    expect(host.textContent).toContain("T old");
    expect(host.textContent).not.toContain("T live");
    const un = host.querySelector('button[aria-label="Unarchive T old"]') as HTMLButtonElement;
    act(() => un.click());
    expect(p.onUnarchive).toHaveBeenCalledWith("old");
  });

  it("CONTROL: the Active tab still lists live rows with their Archive control", () => {
    render({ archivedConvos: [row("old")] });
    expect(host.textContent).toContain("T live");
    expect(host.querySelector('button[aria-label="Archive conversation"]')).not.toBeNull();
  });
});
