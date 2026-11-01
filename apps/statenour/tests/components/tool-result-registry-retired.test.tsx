/**
 * 2026-10-25 · leftovers after wave C. The runPython tool and the arsenal.runPython agent action
 * were removed (E2B_API_KEY is unset in prod, runCode covers the job), but the registry kept a
 * card for them. An old persisted turn can still carry a `tool-arsenal.runPython` part, so the
 * question is what that turn renders once the entry is gone: the plain no-card line from
 * chat-message-list ("<name>: returned data"), never nothing and never a card that says
 * "Code executed" for code that no longer runs here.
 *
 * Harness from chat-message-list-tool-softfail.test.tsx, but the REAL tool-result-card and
 * registry are used: those are the consumer under test.
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
vi.mock("@/components/chat/message-action-sheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/chat/reasoning-trace-modal", () => ({ ReasoningTraceModal: () => null }));
vi.mock("@/components/chat/reasoning-trace-live", () => ({ ReasoningTraceLive: () => null }));

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";
import { TOOL_CONFIG, isKnownToolName } from "@/components/chat/tool-result-registry";

function markupFor(toolName: string, output: unknown): string {
  const list = [
    { id: "m1", role: "user", parts: [{ type: "text", text: "run it" }] },
    {
      id: "m2",
      role: "assistant",
      parts: [{ type: `tool-${toolName}`, toolCallId: "c1", state: "output-available", input: {}, output }],
    },
  ] as unknown as UIMessage[];
  // React separates adjacent text nodes with empty comments.
  return renderToStaticMarkup(<ChatMessageList messages={list} isLoading={false} error={undefined} stopped={null} />).replace(
    /<!-- -->/g,
    "",
  );
}

describe("tool-result registry · arsenal.runPython is retired", () => {
  it("has no card entry for the removed action", () => {
    expect(TOOL_CONFIG["arsenal.runPython"]).toBeUndefined();
    expect(isKnownToolName("arsenal.runPython")).toBe(false);
  });

  it("an old persisted arsenal.runPython part renders the plain no-card line, not a card", () => {
    const markup = markupFor("arsenal.runPython", { ok: true, returnCode: 0 });
    expect(markup).toContain("arsenal.runPython: returned data");
    expect(markup).not.toContain("Code executed");
    expect(markup).not.toContain("Executed successfully");
  });

  it("CONTROL · a live arsenal action next to it still gets its card", () => {
    expect(isKnownToolName("arsenal.browserNavigate")).toBe(true);
    const markup = markupFor("arsenal.browserNavigate", { url: "https://example.com/page" });
    expect(markup).toContain("Navigated successfully");
    expect(markup).not.toContain("arsenal.browserNavigate: returned data");
  });
});
