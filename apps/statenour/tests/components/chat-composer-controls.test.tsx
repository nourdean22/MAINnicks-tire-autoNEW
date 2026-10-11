/**
 * tests/components/chat-composer-controls.test.tsx - task R3-05.
 *
 *   - 09-F21 - the edit-banner Cancel was px-2 py-0.5 at 12px text, about 22px
 *     tall: half the 44px floor tests/e2e/target-size.spec.ts pins.
 *   - 09-F27-N1 - the deep-mode nudge floats over the focused field and could
 *     cover Send; the composer opts out the way the journal does.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "@/features/chat-v2/components/chat-composer";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A client mount: zustand v5 hands renderToStaticMarkup the store's initial state. */
function mount(el: React.ReactElement): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(el));
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

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

const chat = { status: "ready", isStreaming: false, messages: [], sendText: vi.fn(), append: vi.fn() } as any;

afterEach(() => useChatUiStore.setState({ editingMessageId: null, draft: "" }));

describe("ChatComposer controls", () => {
  it("the edit-banner Cancel clears the 44px floor", () => {
    useChatUiStore.setState({ editingMessageId: "m1", draft: "edited" });
    const markup = mount(<ChatComposer chat={chat} />);
    const cancel = markup.match(/<button[^>]*>Cancel<\/button>/)?.[0];
    expect(cancel, "the banner renders a Cancel button").toBeDefined();
    expect(cancel).toContain("min-h-11");
    expect(cancel).not.toContain("py-0.5");
  });

  it("the composer form opts out of the deep-mode nudge", () => {
    const markup = mount(<ChatComposer chat={chat} />);
    expect(markup).toMatch(/<form[^>]*data-no-deep-nudge=""/);
  });
});
