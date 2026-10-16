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

  it("a read still in flight says so, not 'empty'", () => {
    const { container, unmount } = mount(drawer({ listState: "loading" }));
    expect(container.textContent).toContain("Loading history");
    expect(container.textContent).not.toContain("No conversations in this view.");
    unmount();
  });

  it("CONTROL: a measured empty list still says there is nothing in this view", () => {
    const { container, unmount } = mount(drawer({ listState: "ok" }));
    expect(container.textContent).toContain("No conversations in this view.");
    expect(container.textContent).not.toContain("History unavailable");
    unmount();
  });
});
