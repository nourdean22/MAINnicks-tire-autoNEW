/**
 * tests/components/chat-message-list-stopped.test.tsx · audit 09-F29 (task B6).
 *
 * Stop read as success: the always-mounted status region said "Nick
 * finished replying" for a turn the operator stopped, and the bubble had no
 * mark. A stopped turn now carries a visible "Stopped here" rule and the polite
 * region announces the stop instead.
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
vi.mock("@/components/chat/tool-result-card", () => ({ ToolResultCard: () => null, isKnownToolName: () => false }));
vi.mock("@/components/chat/message-action-sheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));
vi.mock("@/features/chat-v2/components/typed-tool-cards", () => ({ TypedToolCards: () => null }));

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";

const messages = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "write the plan" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "Step one is" }] },
] as unknown as UIMessage[];

function render(stopped: { messageId: string; outcome: "pending" | "stopped" | "unconfirmed" } | null, list = messages) {
  return renderToStaticMarkup(
    <ChatMessageList messages={list} isLoading={false} error={undefined} stopped={stopped} />,
  );
}

/** The text inside the role="status" region. */
function announced(markup: string): string {
  return /role="status"[^>]*>([^<]*)</.exec(markup)?.[1] ?? "";
}

describe("ChatMessageList · a stopped turn reads as stopped", () => {
  it("marks the stopped bubble and announces Stopped, not 'finished replying'", () => {
    const markup = render({ messageId: "m2", outcome: "stopped" });
    expect(markup).toContain('data-testid="stopped-turn"');
    expect(announced(markup)).toBe("Stopped here; Nick finishes in the background");
    expect(markup).not.toContain("Nick finished replying");
  });

  it("an unconfirmed stop also says it was not recorded", () => {
    const markup = render({ messageId: "m2", outcome: "unconfirmed" });
    expect(announced(markup)).toBe("Stopped here; Nick finishes in the background, stop not recorded");
  });

  it("a stop before the first token marks the operator's message instead", () => {
    const markup = render({ messageId: "m1", outcome: "stopped" }, messages.slice(0, 1));
    expect(markup).toContain('data-testid="stopped-turn"');
    expect(announced(markup)).toBe("Stopped here; Nick finishes in the background");
  });

  it("control: a stop from another conversation marks nothing", () => {
    const markup = render({ messageId: "elsewhere", outcome: "stopped" });
    expect(markup).not.toContain('data-testid="stopped-turn"');
    expect(announced(markup)).toBe("Nick finished replying");
  });

  it("control: no stop keeps the completion announcement", () => {
    const markup = render(null);
    expect(markup).not.toContain('data-testid="stopped-turn"');
    expect(announced(markup)).toBe("Nick finished replying");
  });
});
