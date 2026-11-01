/**
 * R3-08 hand-off: the one-line summary for a tool with no card said "returned
 * data" for a call that was refused or failed softly ({ error }, { ok: false },
 * { success: false } with state output-available). The card for known tools
 * already says "Waiting for approval" / "Not done" (isSoftFailedToolOutput);
 * this line now agrees. Harness from chat-message-list-stopped.test.tsx.
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

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";

function lineFor(output: unknown, state = "output-available"): string {
  const list = [
    { id: "m1", role: "user", parts: [{ type: "text", text: "text the vendor" }] },
    { id: "m2", role: "assistant", parts: [{ type: "tool-vendorPing", toolCallId: "c1", state, input: {}, output }] },
  ] as unknown as UIMessage[];
  const markup = renderToStaticMarkup(<ChatMessageList messages={list} isLoading={false} error={undefined} stopped={null} />);
  // React separates adjacent text nodes with empty comments.
  return /vendorPing: ([^<]*)</.exec(markup.replace(/<!-- -->/g, ""))?.[1] ?? "(no line)";
}

describe("ChatMessageList - the no-card tool line tells a refusal from data", () => {
  it("an approval refusal reads Waiting for approval", () => {
    expect(lineFor({ error: "approval_required", requestId: "r1" })).toBe("Waiting for approval");
  });

  it("a caught failure ({ ok: false } / { success: false }) reads Not done", () => {
    expect(lineFor({ ok: false, reason: "bridge down" })).toBe("Not done");
    expect(lineFor({ success: false })).toBe("Not done");
  });

  it("control: real data, an empty result, a transport error and a running call keep their words", () => {
    expect(lineFor({ items: [1, 2] })).toBe("returned data");
    expect(lineFor({ items: [] })).toBe("returned no results");
    expect(lineFor(undefined, "output-error")).toBe("failed");
    expect(lineFor(undefined, "input-available")).toBe("running");
  });
});
