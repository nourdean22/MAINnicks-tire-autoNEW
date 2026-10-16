/**
 * UI v3 W3b round 3 (B1): the loaded conversation view is a ruled text column, not a stack of cards.
 * Pinned at the rendered markup: the log grows up from the composer (bottom-anchored), the operator's
 * turn is a ruled line with no fill, the reply is the page's text column at 20 px, the tool cards sit
 * behind the receipt line (a 44 px disclosure that names what ran), and the receipt line is the only
 * chrome per turn (no per-reply "Nick" eyebrow; the screen-reader speaker stays).
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
  UserMessageBubble: ({ text }: { text: string }) => <span>{text}</span>,
  AssistantMessageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/chat/message-action-sheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));
vi.mock("@/features/chat-v2/components/typed-tool-cards", () => ({ TypedToolCards: () => null }));

import type { UIMessage } from "ai";
import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";

const QUESTION = "Demo question: where does the demo supplier quote stand?";
const REPLY = "Demo reply: the demo supplier quote is drafted and waits on one approval.";
// The seeded shape of tests/e2e/fixtures/chat.ts: one user turn, one assistant turn that ran searchMemories.
const searchPart = {
  type: "tool-searchMemories",
  toolCallId: "demo-call-1",
  state: "output-available",
  input: { query: "demo supplier quote" },
  output: { count: 1, results: [{ content: "Demo memory: the demo supplier quote waits on one approval" }] },
};
const conversation = [
  { id: "u1", role: "user", parts: [{ type: "text", text: QUESTION }] },
  { id: "a1", role: "assistant", parts: [searchPart, { type: "text", text: REPLY }] },
] as unknown as UIMessage[];
const textOnly = [
  { id: "u1", role: "user", parts: [{ type: "text", text: QUESTION }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: REPLY }] },
] as unknown as UIMessage[];

const render = (messages: UIMessage[], isLoading = false) => renderToStaticMarkup(<ChatMessageList messages={messages} isLoading={isLoading} error={undefined} />);

describe("the loaded conversation view (W3b round 3, B1)", () => {
  it("grows up from the composer: the log is bottom-anchored", () => {
    const markup = render(conversation);
    expect(markup).toMatch(/<div role="log"[^>]*class="[^"]*\bmin-h-full\b[^"]*"/);
    expect(markup).toMatch(/<div role="log"[^>]*class="[^"]*\bjustify-end\b[^"]*"/);
  });

  it("the operator's turn is a ruled line with no fill, in the column, not a right-aligned bubble", () => {
    const markup = render(conversation);
    // the wrapper that carries the speaker has no fill (the action buttons' hover fill is not a turn fill)
    expect(markup).not.toMatch(/class="[^"]*\bbg-surface-interactive\b[^"]*"[^>]*><span class="sr-only">You:/);
    expect(markup).not.toMatch(/class="flex justify-end"/);
    expect(markup).not.toMatch(/max-w-\[80%\]/);
    // the turn opens with a rule and the speaker is still read out
    expect(markup).toMatch(/border-t border-edge-subtle[^>]*>[\s\S]*?You:/);
  });

  it("the reply is the page's text column at 20px", () => {
    const markup = render(conversation);
    expect(markup).toMatch(/class="[^"]*\btext-\[20px\][^"]*"[^>]*><span class="sr-only">Nick:<\/span>/);
  });

  it("the receipt line is the only chrome per turn: no per-reply Nick eyebrow, the speaker stays for screen readers", () => {
    const markup = render(conversation);
    expect(markup).not.toMatch(/aria-hidden="true">\s*Nick\s*</);
    expect(markup).toContain('<span class="sr-only">Nick:</span>');
  });

  it("the tool card sits behind the receipt line: a 44px disclosure that names what ran, the card inside it", () => {
    const markup = render(conversation);
    const details = /<details[^>]*>([\s\S]*?)<\/details>/.exec(markup);
    expect(details, "no disclosure around the tool cards").not.toBeNull();
    const summary = /<summary[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/summary>/.exec(details![1]);
    expect(summary, "no summary line").not.toBeNull();
    expect(summary![1]).toContain("min-h-11");
    expect(summary![2]).toContain("Tool calls: 1 returned data");
    expect(summary![2]).toContain("Memories found, 1 match");
    // the card (its done label is rendered by ToolResultCard) is inside the disclosure, after the summary
    const afterSummary = details![1].slice(details![1].indexOf("</summary>"));
    expect(afterSummary).toContain("Memories found");
    // and the disclosure is closed on a finished turn
    expect(details![0]).not.toMatch(/^<details[^>]*\sopen/);
  });

  it("while the latest reply is still streaming its tool cards are open (the running cards stay visible)", () => {
    const markup = render(conversation, true);
    expect(markup).toMatch(/<details[^>]*\sopen/);
  });

  it("CONTROL: a reply that ran no tool gets no disclosure (and, with no live trace, no receipt line either, as before)", () => {
    const markup = render(textOnly);
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
    expect(markup).not.toContain("Tool calls");
  });
});
