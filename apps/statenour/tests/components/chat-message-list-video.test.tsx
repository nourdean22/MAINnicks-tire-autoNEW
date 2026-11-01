// @vitest-environment jsdom
/**
 * U3 (2026-10-31) · the chat list mounts the tap-to-play video card under a message that carries a
 * video link: under Nour's own message, and under Nick's once the reply has finished streaming
 * (a half-written URL mid-stream is not a link yet).
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type { UIMessage } from "ai";

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

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";

const messages = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "watch https://youtu.be/dQw4w9WgXcQ" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "Here: https://vimeo.com/76979871" }] },
] as unknown as UIMessage[];

const render = (isLoading: boolean) =>
  renderToStaticMarkup(<ChatMessageList messages={messages} isLoading={isLoading} error={undefined} />);

describe("ChatMessageList · video links (U3)", () => {
  it("idle: a Play card under his message and under Nick's reply", () => {
    const html = render(false);
    expect(html).toContain("Play YouTube video here");
    expect(html).toContain("Play Vimeo video here");
  });

  it("while Nick's reply streams, only his own message has the card", () => {
    const html = render(true);
    expect(html).toContain("Play YouTube video here");
    expect(html).not.toContain("Play Vimeo video here");
  });
});
