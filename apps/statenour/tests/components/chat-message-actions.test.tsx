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
vi.mock("@/features/chat-v2/components/typed-tool-cards", () => ({
  TypedToolCards: () => null,
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
          // createQuickQuote is flagged sideEffecting in TOOL_CATALOG.
          { type: "tool-createQuickQuote", state: "output-available", output: {} },
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

  // ── 2026-08-30 · review P2 — the auto-narration preference lives here
  // now (the composer dial was removed by operator directive). Without a
  // surface the persisted preference is a dead control.
  it("exposes the persisted auto-read preference on the row", () => {
    const on = render({ tts: speakingTts });
    expect(on).toContain("Auto-read replies is on (tap to turn off)");
    const off = render({ tts: { ...speakingTts, enabled: false } });
    expect(off).toContain("Auto-read replies is off (tap to turn on)");
  });
});
