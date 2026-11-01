/**
 * tests/components/chat-message-list-verify-tail.test.tsx · Nour's recordings, 2026-10-29 21:35Z.
 *
 * A multi-step reply (text, tools, text) rendered one shell per text part: an empty step drew a
 * blank block with its own badge strip, and every step repeated the strip, so one reply read as
 * several. And after the draft finished, the server's 45-90 s verify tail showed nothing but a red
 * Stop button.
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
  AssistantMessageShell: ({ children, contextBlocks }: { children: React.ReactNode; contextBlocks?: unknown }) => (
    <div data-shell={contextBlocks ? "badges" : "plain"}>{children}</div>
  ),
}));
vi.mock("@/components/chat/tool-result-card", () => ({ ToolResultCard: () => null, isKnownToolName: () => false }));
vi.mock("@/components/chat/message-action-sheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));
vi.mock("@/features/chat-v2/components/typed-tool-cards", () => ({ TypedToolCards: () => null }));

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";

const user = { id: "m1", role: "user", parts: [{ type: "text", text: "what happened" }] };
const steps = {
  id: "m2",
  role: "assistant",
  parts: [
    { type: "step-start" },
    { type: "text", text: "first step", state: "done" },
    { type: "tool-searchTools", state: "output-available", input: {}, output: {} },
    { type: "step-start" },
    { type: "text", text: "", state: "done" },
    { type: "step-start" },
    { type: "text", text: "final step", state: "done" },
  ],
};

function render(list: unknown[], isLoading = false) {
  return renderToStaticMarkup(
    <ChatMessageList messages={list as UIMessage[]} isLoading={isLoading} error={undefined} liveContextBlocks={{ recall: true }} />,
  );
}
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("ChatMessageList · one reply reads as one reply", () => {
  it("an empty step draws nothing and the badge strip shows once, under the last text", () => {
    const markup = render([user, steps]);
    expect(count(markup, "data-shell="), "two non-empty text parts").toBe(2);
    expect(count(markup, 'data-shell="badges"')).toBe(1);
    expect(markup.indexOf('data-shell="plain"')).toBeLessThan(markup.indexOf('data-shell="badges"'));
  });

  it("CONTROL: the empty last part of a reply still streaming keeps its shell (the caret)", () => {
    const live = { ...steps, parts: [...steps.parts.slice(0, 3), { type: "step-start" }, { type: "text", text: "", state: "streaming" }] };
    expect(count(render([user, live], true), "data-shell=")).toBe(2);
  });
});

describe("ChatMessageList · the verify tail says what is happening", () => {
  it("draft done, turn still open: says Nick is checking the reply", () => {
    expect(render([user, steps], true)).toContain("Checking the reply");
  });

  it("CONTROL: still writing, or the turn is over: no line", () => {
    const writing = { ...steps, parts: [...steps.parts.slice(0, -1), { type: "text", text: "final", state: "streaming" }] };
    expect(render([user, writing], true)).not.toContain("Checking the reply");
    expect(render([user, steps], false)).not.toContain("Checking the reply");
  });

  it("B2: the turn closed on the draft and the server is still checking: the line stays", () => {
    expect(render([user, { ...steps, metadata: { verifying: true } }], false)).toContain("Checking the reply");
  });

  it("B2 CONTROL: an older reply keeps its mark after a new send, but no line", () => {
    const later = { id: "m4", role: "assistant", parts: [{ type: "text", text: "newer reply", state: "done" }] };
    const markup = render([user, { ...steps, metadata: { verifying: true } }, { ...user, id: "m3" }, later], false);
    expect(markup).not.toContain("Checking the reply");
  });

  it("CONTROL: a tool still running is not the verify tail", () => {
    const tool = { ...steps, parts: [...steps.parts, { type: "tool-searchTools", state: "input-available", input: {} }] };
    expect(render([user, tool], true)).not.toContain("Checking the reply");
  });
});
