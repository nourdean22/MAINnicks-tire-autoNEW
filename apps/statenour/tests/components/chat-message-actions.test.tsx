import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type { UIMessage } from "ai";

// 2026-08-28 · Per-message action row.
//
// Copy / Edit / Read / Retry existed before this, but ONLY inside
// MessageActionSheet — reachable only by long-pressing a bubble. The
// operator reported them as missing, which is the correct read: an
// undiscoverable gesture is indistinguishable from an absent feature.
// These tests pin the visible row so it cannot regress back into a
// hidden gesture.

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
  { id: "m1", role: "user", parts: [{ type: "text", text: "status?" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "All green." }] },
] as unknown as UIMessage[];

const speakingTts = {
  supported: true,
  enabled: true,
  narrating: false,
  narratingEngine: null,
  rate: 1,
  speakingMessageId: null,
  speakMessage: () => {},
  stop: () => {},
  toggle: () => {},
  cycleRate: () => {},
} as any;

function render(opts: { isLoading?: boolean; tts?: unknown } = {}): string {
  return renderToStaticMarkup(
    <ChatMessageList
      messages={messages}
      isLoading={opts.isLoading ?? false}
      error={undefined}
      onRetry={() => {}}
      tts={opts.tts as never}
    />,
  );
}

describe("ChatMessageList · visible per-message actions", () => {
  it("renders an action row under both the user and the assistant message", () => {
    const markup = render({ tts: speakingTts });
    expect(markup).toContain('data-testid="message-actions-user"');
    expect(markup).toContain('data-testid="message-actions-assistant"');
  });

  it("offers Copy on every message and Edit only on the operator's own", () => {
    const markup = render({ tts: speakingTts });
    expect(markup).toContain('aria-label="Copy message"');
    // Exactly one Edit — the user turn. Editing Nick's reply is not a thing.
    expect(markup.split('aria-label="Edit and resend"').length - 1).toBe(1);
  });

  it("puts Read aloud and Regenerate on the assistant turn", () => {
    const markup = render({ tts: speakingTts });
    expect(markup).toContain('aria-label="Read aloud"');
    expect(markup).toContain('aria-label="Regenerate reply"');
  });

  // A Read button with no speech engine behind it is a dead control —
  // this repo's signature defect. It must not render at all.
  it("hides Read aloud when no speech engine exists", () => {
    const markup = render({ tts: { supported: false } });
    expect(markup).not.toContain('aria-label="Read aloud"');
    // The rest of the row still renders.
    expect(markup).toContain('aria-label="Copy message"');
  });

  it("suppresses the row on the assistant turn that is still streaming", () => {
    const markup = render({ isLoading: true, tts: speakingTts });
    // The user turn keeps its actions; the in-flight reply does not get
    // a Copy button that would capture half a sentence.
    expect(markup).toContain('data-testid="message-actions-user"');
    expect(markup).not.toContain('data-testid="message-actions-assistant"');
  });

  it("always exposes the overflow sheet as the long-tail surface", () => {
    const markup = render({ tts: speakingTts });
    expect(markup.split('aria-label="More actions"').length - 1).toBe(2);
  });

  // ── 2026-08-30 · review P1 — the safety canary ──────────────────────
  // Regeneration replays the whole turn, side-effecting tool calls
  // included. A turn that ran one must NOT offer Regenerate — a casual
  // tap would re-run the SMS/quote/payment on the shop. Catalog-driven:
  // any tool flagged sideEffecting is covered.
  it("BREAKS: no Regenerate on an assistant turn that ran a side-effecting tool", () => {
    const sideEffectMessages = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "text Brennen a quote" }] },
      {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "text", text: "Sent." },
          // stageCustomerAlert is flagged sideEffecting in TOOL_CATALOG.
          { type: "tool-stageCustomerAlert", state: "output-available", output: {} },
        ],
      },
    ] as unknown as UIMessage[];
    const markup = renderToStaticMarkup(
      <ChatMessageList
        messages={sideEffectMessages}
        isLoading={false}
        error={undefined}
        onRetry={() => {}}
        tts={speakingTts as never}
      />,
    );
    expect(markup).not.toContain('aria-label="Regenerate reply"');
    // Read and Copy still on offer — only the replay is refused.
    expect(markup).toContain('aria-label="Read aloud"');
    expect(markup).toContain('aria-label="Copy message"');
  });

  // R3-05 (09-F23): the auto-read preference is one global setting, so it
  // lives once in the chat-island header (tests/components/chat-island-header
  // .test.tsx), not on every reply.
  it("no reply row carries the global auto-read toggle", () => {
    expect(render({ tts: speakingTts })).not.toContain("Auto-read replies");
  });
});

// R3-05 (09-F22 + 09-F23): a 20-turn thread rendered about 70 action buttons.
// Only the latest user turn and the latest reply keep the full row; older
// turns keep More, which opens the sheet with Copy, Edit and Read.
describe("ChatMessageList . older turns get a compact row", () => {
  const thread = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "first question" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "first answer" }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "second question" }] },
    { id: "a2", role: "assistant", parts: [{ type: "text", text: "second answer" }] },
  ] as unknown as UIMessage[];
  const markup = renderToStaticMarkup(
    <ChatMessageList messages={thread} isLoading={false} error={undefined} onRetry={() => {}} tts={speakingTts} />,
  );
  const count = (label: string) => markup.split(`aria-label="${label}"`).length - 1;

  it("Copy only on the latest user turn and the latest reply", () => {
    expect(count("Copy message")).toBe(2);
    expect(count("Edit and resend")).toBe(1);
    expect(count("Read aloud")).toBe(1);
  });

  it("More on every turn", () => {
    expect(count("More actions")).toBe(4);
  });

  it("no per-reply copies of the global auto-read toggle", () => {
    expect(markup).not.toContain("Auto-read replies");
  });
});
