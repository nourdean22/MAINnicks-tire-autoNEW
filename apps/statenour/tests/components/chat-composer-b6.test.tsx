/**
 * tests/components/chat-composer-b6.test.tsx · audit 09-F10 / 09-F11 / 09-F12 (task B6).
 *
 *   · 09-F12: the composer draft lived only in zustand memory, so a reload or
 *     an iOS PWA eviction ate it. hooks/use-draft-autosave.ts existed with no
 *     caller (the old test mocked it; nothing rendered it).
 *   · 09-F11: a pending "Replace draft?" renders as an in-DOM two-button
 *     confirm (window.confirm is silently suppressed in the iOS PWA).
 *   · 09-F10: the textarea declares its Enter key: "send" on a fine pointer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const autosave = vi.fn(() => ({ clearDraft: () => {}, restore: () => null }));

// zustand v5 hands getInitialState() to useSyncExternalStore as the SERVER
// snapshot, so setState() on the real store is invisible to a static render
// (see evidence-mark-modes.test.tsx). Stub: selectors read `ui.state`; any
// action the composer selects is a no-op.
const ui = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/features/chat-v2/stores/chat-ui-store", () => {
  const read = () =>
    new Proxy(ui.state, { get: (target, key) => (key in target ? target[key as string] : () => {}) });
  const useChatUiStore = Object.assign((selector: (s: unknown) => unknown) => selector(read()), { getState: read });
  return { useChatUiStore };
});

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
  useDraftAutosave: (opts: unknown) => autosave(opts),
}));

import { ChatComposer, restoreComposerDraft } from "@/features/chat-v2/components/chat-composer";

const chat = { status: "ready", isStreaming: false, sendText: vi.fn(), append: vi.fn(), messages: [] } as never;

beforeEach(() => {
  autosave.mockClear();
  ui.state = { draft: "", editingMessageId: null, draftReplace: null, privateMode: false };
});

describe("09-F12 · the draft is persisted", () => {
  it("hands the live draft to useDraftAutosave under the composer key", () => {
    ui.state.draft = "half-typed thought";
    renderToStaticMarkup(<ChatComposer chat={chat} />);
    expect(autosave).toHaveBeenCalledWith(expect.objectContaining({ key: "chat-composer", value: "half-typed thought" }));
  });

  it("Private Lab writes nothing: autosave gets an empty value, which also drops any saved draft", () => {
    ui.state.draft = "private thought";
    ui.state.privateMode = true;
    renderToStaticMarkup(<ChatComposer chat={chat} />);
    expect(autosave).toHaveBeenCalledWith(expect.objectContaining({ key: "chat-composer", value: "" }));
    expect(autosave).not.toHaveBeenCalledWith(expect.objectContaining({ value: "private thought" }));
  });

  it("restoreComposerDraft puts a saved draft back into an empty composer", () => {
    const setDraft = vi.fn();
    restoreComposerDraft({ restore: () => "saved before reload", currentDraft: "", setDraft });
    expect(setDraft).toHaveBeenCalledWith("saved before reload");
  });

  it("restoreComposerDraft never clobbers text already in the composer (deep-link prefill)", () => {
    const setDraft = vi.fn();
    restoreComposerDraft({ restore: () => "saved before reload", currentDraft: "prefilled", setDraft });
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("restoreComposerDraft ignores an empty or missing save", () => {
    const setDraft = vi.fn();
    restoreComposerDraft({ restore: () => null, currentDraft: "", setDraft });
    restoreComposerDraft({ restore: () => "   ", currentDraft: "", setDraft });
    expect(setDraft).not.toHaveBeenCalled();
  });
});

describe("09-F11 · Replace draft? is an in-DOM two-tap confirm", () => {
  it("renders the question with Replace and Keep draft buttons when a replace is pending", () => {
    ui.state = { draft: "typed", editingMessageId: null, draftReplace: { text: "sent message", editingMessageId: "m1" } };
    const markup = renderToStaticMarkup(<ChatComposer chat={chat} />);
    expect(markup).toContain("Replace draft?");
    expect(markup).toMatch(/<button type="button"[^>]*>Replace<\/button>/);
    expect(markup).toMatch(/<button type="button"[^>]*>Keep draft<\/button>/);
  });

  it("control: no pending replace, no question", () => {
    ui.state.draft = "typed";
    expect(renderToStaticMarkup(<ChatComposer chat={chat} />)).not.toContain("Replace draft?");
  });
});

describe("09-F10 · the textarea declares its Enter key", () => {
  it("is 'send' on a fine pointer (the server render default)", () => {
    expect(renderToStaticMarkup(<ChatComposer chat={chat} />)).toMatch(/enterkeyhint="send"/i);
  });
});
