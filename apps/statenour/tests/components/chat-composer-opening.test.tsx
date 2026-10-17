/**
 * UI v3 W3b round 3 (A1b): while a conversation is opening (use-conversations isLoadingConvo) the
 * composer is disabled and says why. Round 2 kept the transcript on screen until the rows land, so a
 * send went to what was visible; a send that races the open still targets a conversation the operator
 * has not seen. The line is a status region (announced), the controls are disabled, nothing is hidden.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { ChatComposer } from "@/features/chat-v2/components/chat-composer";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => "t1"), dismiss: vi.fn() }),
}));
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

const chat = { status: "ready", isStreaming: false, messages: [], sendText: vi.fn(), append: vi.fn() } as never;
const REASON = "Opening that conversation. Send once it is on screen.";

describe("ChatComposer while a conversation is opening", () => {
  it("disables the field and Send, and says why in a status region", () => {
    const markup = renderToStaticMarkup(<ChatComposer chat={chat} disabledReason={REASON} />);
    expect(markup).toMatch(/<textarea[^>]*\sdisabled=""/);
    expect(markup).toMatch(/<button[^>]*aria-label="Send message"[^>]*\sdisabled=""/);
    expect(markup).toMatch(new RegExp(`<p[^>]*role="status"[^>]*>${REASON}</p>`));
  });

  it("CONTROL: with no reason the field is live and no line renders", () => {
    const markup = renderToStaticMarkup(<ChatComposer chat={chat} />);
    expect(markup).not.toMatch(/<textarea[^>]*\sdisabled=""/);
    expect(markup).not.toContain(REASON);
  });
});
