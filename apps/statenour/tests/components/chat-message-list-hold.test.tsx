/**
 * UI v3 W3b: the error card persists a Retry hold. The hold used to be a sonner toast only
 * (use-chat-stream.ts), gone in seconds; the card now shows the same RETRY_* words, from the
 * controller's `hold` field, next to the Retry the hold was about. Retry stays on the card:
 * every tap still goes through safeRegenerate, which re-checks the saved turn.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = {
    useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
    useQuery: () => ({ data: undefined, isLoading: false }),
  };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  const routerProxy: Record<string | symbol, unknown> = new Proxy({}, { get: (_target, prop) => (prop === "useUtils" ? () => ({}) : procProxy) });
  return { trpc: routerProxy };
});
vi.mock("@/hooks/chat/use-lazy-render-messages", () => ({
  useLazyRenderMessages: (messages: unknown[]) => ({ renderedMessages: messages, hasHidden: false, hiddenCount: 0, showOlder: () => {} }),
}));
vi.mock("@/components/chat/nick-message", () => ({ NickMessage: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("@/components/chat/message-bubble-shells", () => ({
  UserMessageBubble: ({ text }: { text: string }) => <div>{text}</div>,
  AssistantMessageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/chat/tool-result-card", () => ({ ToolResultCard: () => null, isKnownToolName: () => false }));
vi.mock("@/components/chat/message-action-sheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));
vi.mock("@/features/chat-v2/components/typed-tool-cards", () => ({ TypedToolCards: () => null }));

import type { UIMessage } from "ai";
import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";
import { RETRY_HELD_RAN, RETRY_HELD_UNCONFIRMED } from "@/features/chat-v2/lib/saved-turn";

const messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }] as unknown as UIMessage[];
const error = new Error('{"error":"Chat stream failed"}');

describe("ChatMessageList error card with a Retry hold", () => {
  it("shows the hold's own words (the RETRY_* constant) beside Retry", () => {
    const markup = renderToStaticMarkup(
      <ChatMessageList messages={messages} isLoading={false} error={error} hold={RETRY_HELD_RAN} onRetry={() => {}} />,
    );
    expect(markup).toContain(RETRY_HELD_RAN.replace(/'/g, "&#x27;"));
    expect(markup).toContain(">Retry<");
  });

  it("renders whichever constant the controller holds, never a copy of its own", () => {
    const markup = renderToStaticMarkup(
      <ChatMessageList messages={messages} isLoading={false} error={error} hold={RETRY_HELD_UNCONFIRMED} onRetry={() => {}} />,
    );
    expect(markup).toContain(RETRY_HELD_UNCONFIRMED.replace(/'/g, "&#x27;"));
    expect(markup).not.toContain(RETRY_HELD_RAN.replace(/'/g, "&#x27;"));
  });

  it("CONTROL: no hold, no hold line", () => {
    const markup = renderToStaticMarkup(<ChatMessageList messages={messages} isLoading={false} error={error} hold={null} onRetry={() => {}} />);
    expect(markup).not.toContain("Retry is held");
    expect(markup).not.toContain("Send a new message instead");
    expect(markup).toContain(">Retry<");
  });
});
