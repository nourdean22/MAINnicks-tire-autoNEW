/**
 * UI v3 W3b: the empty chat is the headline and the four starters. The NICK eyebrow (the header
 * already says Nick) and the two-line description are gone; the headline carries the verdict
 * role Home uses (vt-verdict), the one line a page may shout; the starters keep their words
 * (tests/chat/starters-copy.test.ts pins COMMANDS).
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

describe("ChatMessageList empty state (W3b)", () => {
  const markup = renderToStaticMarkup(<ChatMessageList messages={[]} isLoading={false} error={undefined} />);

  it("the headline is the hero, in the verdict role", () => {
    expect(markup).toMatch(/<h2 class="[^"]*vt-verdict[^"]*"[^>]*>What are we solving\?<\/h2>/);
  });

  it("no NICK eyebrow and no description paragraph above the starters", () => {
    expect(markup).not.toMatch(/>NICK</);
    expect(markup).not.toContain("Live business data");
  });

  it("the four starters stay, as ruled rows", () => {
    for (const label of ["Run my command brief", "What needs my judgment", "Plan today around reality", "Show verified recent actions"]) {
      expect(markup).toContain(label);
    }
  });

  it("a reply's speaker label is sentence case", () => {
    const withReply = renderToStaticMarkup(
      <ChatMessageList
        messages={[{ id: "a1", role: "assistant", parts: [{ type: "text", text: "hello" }] }] as unknown as UIMessage[]}
        isLoading={false}
        error={undefined}
      />,
    );
    expect(withReply).toMatch(/aria-hidden="true">\s*Nick\s*<\/p>/);
    expect(withReply).not.toMatch(/>\s*NICK\s*</);
  });
});
