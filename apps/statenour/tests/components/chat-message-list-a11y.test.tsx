import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type { UIMessage } from "ai";

// 2026-08-08 · a11y contract for the chat feed: role="log" live region,
// aria-busy batching while a reply streams, and the always-mounted
// role="status" completion announcer. Rendered (props → DOM), not
// source-matched — heavy children are mocked because this test is about
// the LIST's semantics, not the renderers it composes.

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
  const routerProxy: Record<string | symbol, unknown> = new Proxy(
    {},
    { get: (_target, prop) => (prop === "useUtils" ? () => ({}) : procProxy) },
  );
  return { trpc: routerProxy };
});

vi.mock("@/hooks/chat/use-lazy-render-messages", () => ({
  useLazyRenderMessages: (messages: UIMessage[]) => ({
    renderedMessages: messages,
    hasHidden: false,
    hiddenCount: 0,
    showOlder: () => {},
  }),
}));

vi.mock("@/components/chat/nick-message", () => ({
  NickMessage: ({ text }: { text: string }) => <div>{text}</div>,
}));
vi.mock("@/components/chat/message-bubble-shells", () => ({
  UserMessageBubble: ({ text }: { text: string }) => <div>{text}</div>,
  AssistantMessageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/chat/tool-result-card", () => ({
  ToolResultCard: () => null,
  isKnownToolName: () => false,
}));
vi.mock("@/components/chat/message-action-sheet", () => ({
  MessageActionSheet: () => null,
}));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({
  ReasoningTraceModal: () => null,
}));
vi.mock("@/components/chat/reasoning-trace-live", () => ({
  ReasoningTraceLive: () => null,
}));
vi.mock("@/features/chat-v2/components/typed-tool-cards", () => ({
  TypedToolCards: () => null,
}));

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";

const messages = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "status?" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "All green." }] },
] as unknown as UIMessage[];

function render(isLoading: boolean): string {
  return renderToStaticMarkup(
    <ChatMessageList messages={messages} isLoading={isLoading} error={undefined} />,
  );
}

describe("ChatMessageList · streaming a11y semantics", () => {
  it("idle: log region is not busy and the completion announcer carries text", () => {
    const markup = render(false);
    expect(markup).toContain('role="log"');
    expect(markup).toContain('aria-label="Chat messages"');
    expect(markup).toContain('aria-busy="false"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Nick finished replying");
  });

  it("streaming: the log is busy and the announcer is empty (no per-token spam)", () => {
    const markup = render(true);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("Nick finished replying");
    // Announcer element itself must STAY mounted while empty — polite
    // regions that mount on demand never announce.
    expect(markup).toContain('role="status"');
  });
});
