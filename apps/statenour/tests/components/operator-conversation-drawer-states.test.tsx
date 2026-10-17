/**
 * UI v3 W3b: the History drawer tells a failed read from an empty one (empty-vs-error).
 * Before this, the drawer printed "No conversations in this view." for loading, error and
 * a real empty list alike.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: async () => false, dialog: null }),
  usePromptDialog: () => ({ prompt: async () => null, dialog: null }),
}));

import { OperatorConversationDrawer } from "@/features/chat-v2/components/operator-conversation-drawer";

function mount(el: React.ReactElement) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(el));
  return { container, unmount: () => act(() => root.unmount()) };
}

const noop = () => {};
function drawer(over: Partial<React.ComponentProps<typeof OperatorConversationDrawer>>) {
  return (
    <OperatorConversationDrawer
      convos={[]}
      activeId={null}
      pinnedIds={new Set()}
      hasMore={false}
      loadingMore={false}
      listState="ok"
      onRetryList={noop}
      onLoadMore={noop}
      onSelect={noop}
      onDelete={noop}
      onRename={noop}
      onTogglePin={noop}
      onArchive={noop}
      onNew={noop}
      onShowActions={noop}
      onClose={noop}
      {...over}
    />
  );
}

describe("OperatorConversationDrawer list states", () => {
  it("a failed list read reads as unavailable, with a Retry that reads again", () => {
    const onRetryList = vi.fn();
    const { container, unmount } = mount(drawer({ listState: "error", onRetryList }));
    expect(container.textContent).toContain("History unavailable");
    expect(container.textContent).not.toContain("No conversations in this view.");
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Retry");
    expect(retry, "no Retry button").toBeDefined();
    act(() => retry!.click());
    expect(onRetryList).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("a read still in flight says so, not 'empty', in a status region with Retry still mounted but disabled", () => {
    const { container, unmount } = mount(drawer({ listState: "loading" }));
    expect(container.textContent).toContain("Loading history");
    expect(container.textContent).not.toContain("No conversations in this view.");
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toContain("Loading history");
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Retry") as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    unmount();
  });

  it("CONTROL: a measured empty list still says there is nothing in this view", () => {
    const { container, unmount } = mount(drawer({ listState: "ok" }));
    expect(container.textContent).toContain("No conversations in this view.");
    expect(container.textContent).not.toContain("History unavailable");
    unmount();
  });

  // d07fe3e11: reloadConvos runs again after a new conversation is created, so the loading line used to
  // flash above rows the drawer already held. Round 3 (A4) pins the guard with rows present.
  describe("with rows already in the drawer", () => {
    const rows = [{ id: "c1", title: "A kept conversation", createdAt: "2026-10-16T12:00:00.000Z", _count: { messages: 2 } }];

    it("a background reload keeps the rows and shows no loading line", () => {
      const { container, unmount } = mount(drawer({ listState: "loading", convos: rows }));
      expect(container.textContent).toContain("A kept conversation");
      expect(container.textContent).not.toContain("Loading history");
      unmount();
    });

    it("a failed reload with rows present still says the list is unavailable (the rows are stale)", () => {
      const { container, unmount } = mount(drawer({ listState: "error", convos: rows }));
      expect(container.textContent).toContain("A kept conversation");
      expect(container.textContent).toContain("History unavailable");
      unmount();
    });
  });
});
