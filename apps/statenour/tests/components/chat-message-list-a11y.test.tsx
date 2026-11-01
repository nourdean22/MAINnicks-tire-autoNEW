// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { UIMessage } from "ai";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A client mount: zustand v5 hands renderToStaticMarkup the store's initial state. */
function mount(el: React.ReactElement): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(el));
  const html = container.innerHTML;
  act(() => root.unmount());
  return html;
}

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

import { ChatMessageList } from "@/features/chat-v2/components/chat-message-list";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

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

  // R3-15 (review finding 2): a turn that ended in an error did not finish.
  it("idle after an error: the announcer reads the error, never 'finished replying'", () => {
    const markup = renderToStaticMarkup(
      <ChatMessageList messages={messages} isLoading={false} error={new Error("Load failed")} />,
    );
    const status = markup.split('role="status"')[1]?.split("</div>")[0] ?? "";
    expect(status).not.toContain("Nick finished replying");
    expect(status).toContain("Load failed");
  });

  // R3-05 (09-F5): aria-busy alone is a hint some screen readers ignore, so
  // they read every token. The log is silenced; the status line announces.
  it("streaming: the log itself never announces (aria-live off)", () => {
    expect(render(true)).toMatch(/role="log"[^>]*aria-live="off"/);
  });

  // R3-05 (09-F20): no turn named its speaker to a screen reader.
  it("names the speaker of every turn for screen readers", () => {
    const markup = render(false);
    const you = markup.indexOf('<span class="sr-only">You:</span>');
    const nick = markup.indexOf('<span class="sr-only">Nick:</span>');
    expect(you).toBeGreaterThan(-1);
    expect(nick).toBeGreaterThan(-1);
    expect(you).toBeLessThan(markup.indexOf("status?"));
    expect(nick).toBeLessThan(markup.indexOf("All green."));
    expect(nick).toBeGreaterThan(markup.indexOf("status?"));
  });
});

// R3-05 (09-F6): two honesty signals sat under 4.5:1: the interrupted-turn
// reason at 60% alpha and the whole pending bubble at 75% opacity.
describe("ChatMessageList . honesty signals keep full contrast", () => {
  const ALPHA_TEXT = /^text-.*\/\d+$/;
  const OPACITY = /^opacity-\d+$/;
  const classTokens = (html: string) =>
    [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);

  it("CONTROL: the scan flags a planted alpha text class", () => {
    expect(classTokens('<p class="mt-1 text-[11px] text-red-300/60">x</p>').some((t) => ALPHA_TEXT.test(t))).toBe(true);
  });

  it("an errored turn and a pending send carry no alpha text and no opacity", () => {
    useChatUiStore.setState({
      pending: [{ tempId: "p1", conversationId: null, text: "queued", createdAt: 0, status: "sending" }],
    });
    try {
      const markup = mount(
        <ChatMessageList
          messages={[
            messages[0],
            { id: "e1", role: "assistant", parts: [], streamingState: "errored" } as unknown as UIMessage,
          ]}
          isLoading={false}
          error={undefined}
        />,
      );
      expect(markup).toContain("This turn failed before any reply.");
      expect(markup).toContain("Sending");
      const tokens = classTokens(markup);
      expect(tokens.filter((t) => ALPHA_TEXT.test(t))).toEqual([]);
      expect(tokens.filter((t) => OPACITY.test(t))).toEqual([]);
    } finally {
      useChatUiStore.setState({ pending: [] });
    }
  });
});

// R3-05 (04-X13 a): a pre-stream failure is the raw response body.
describe("ChatMessageList . error card text", () => {
  it("shows a sentence, never the JSON body", () => {
    const markup = renderToStaticMarkup(
      <ChatMessageList messages={messages} isLoading={false} error={new Error('{"error":"Chat stream failed"}')} onRetry={() => {}} />,
    );
    expect(markup).toContain("Chat stream failed.");
    expect(markup).not.toContain("{&quot;error");
  });
});

// 2026-09-02 · Receipt-chip honesty. The chip mounts whenever the latest
// assistant turn carries a traceId, which is the COMMON case for a plain
// conversational reply that ran no tools. It computed `allEmpty` behind a
// `counts.total > 0` guard, so zero tool parts fell through to the
// emerald "verified" shield while the count text was hidden by its own
// `total > 0` guard -- a bare green shield over a turn that proved
// nothing. Asserted through rendered markup, not source-matched.
describe("ChatMessageList . receipt chip does not over-claim", () => {
  function renderWithTrace(): string {
    return renderToStaticMarkup(
      <ChatMessageList
        messages={messages}
        isLoading={false}
        error={undefined}
        lastTraceId="trace-abc"
      />,
    );
  }

  it("says so plainly when a turn ran no tools", () => {
    expect(renderWithTrace()).toContain("no tools run");
  });

  it("does NOT paint the verification shield green for zero receipts", () => {
    const markup = renderWithTrace();
    // The canary: emerald is reserved for receipts that actually returned.
    // If this ever passes again, the chip is claiming verification it does
    // not have -- the exact defect the 2026-08-29 fix half-closed.
    expect(markup).not.toContain("text-emerald-400");
    expect(markup).toContain("text-fg-tertiary");
  });

  // R3-05 (10-X4): the observability page reads no ?search= param, so the
  // link promised a filtered trace and opened the unfiltered page.
  it("no longer links to the cut observability page, and promises no filtered trace", () => {
    const markup = renderWithTrace();
    expect(markup).not.toContain("/system/cockpit-observability");
    expect(markup).not.toContain("?search=");
    expect(markup).not.toContain("View trace");
  });
});
