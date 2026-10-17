/**
 * UI v3 W3b: a conversation that failed to open renders a Retry line, never the starter screen
 * (the starters would invite a send while the active conversation did not move).
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

describe("ChatMessageList with a failed open", () => {
  it("shows the failure and a Retry for that conversation, and no starters", () => {
    const markup = renderToStaticMarkup(
      <ChatMessageList messages={[]} isLoading={false} error={undefined} loadFailedId="c9" onRetryLoad={() => {}} />,
    );
    expect(markup).toContain("Couldn&#x27;t open that conversation");
    expect(markup).toContain(">Retry<");
    expect(markup).not.toContain("What are we solving?");
    expect(markup).not.toContain("Run my command brief");
  });

  it("renders above a restored transcript too, and keeps Retry mounted (disabled) while the re-read runs", () => {
    const messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }] as unknown as UIMessage[];
    const markup = renderToStaticMarkup(
      <ChatMessageList messages={messages} isLoading={false} isLoadingConvo error={undefined} loadFailedId="c9" onRetryLoad={() => {}} />,
    );
    expect(markup).toContain("Couldn&#x27;t open that conversation");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Retry<\/button>/);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("hi");
  });

  // PR #3090 review 4299648926: with a long transcript kept, a card at the top of the log is scrolled
  // out of view; the log is bottom-anchored and follows the bottom, so the card is its last visible
  // element, next to the composer, and still a status region.
  it("with a long transcript, the card is the log's last visible element (after the newest turn)", () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 ? "assistant" : "user",
      parts: [{ type: "text", text: `turn ${i}` }],
    })) as unknown as UIMessage[];
    const markup = renderToStaticMarkup(
      <ChatMessageList messages={messages} isLoading={false} error={undefined} loadFailedId="c9" onRetryLoad={() => {}} />,
    );
    const card = markup.indexOf("Couldn&#x27;t open that conversation");
    expect(card).toBeGreaterThan(markup.indexOf("turn 11"));
    // nothing visible follows it inside the log: only the sr-only completion announcer
    const after = markup.slice(card).replace(/<div role="status" aria-live="polite" class="sr-only">[^<]*<\/div>/, "");
    expect(after).not.toMatch(/turn \d+/);
    const cardOpen = markup.lastIndexOf("<div", card);
    expect(markup.slice(cardOpen, card)).toContain('role="status"');
  });

  it("CONTROL: with no failed open the starters render", () => {
    const markup = renderToStaticMarkup(<ChatMessageList messages={[]} isLoading={false} error={undefined} loadFailedId={null} />);
    expect(markup).toContain("Run my command brief");
    expect(markup).not.toContain("open that conversation");
  });
});
