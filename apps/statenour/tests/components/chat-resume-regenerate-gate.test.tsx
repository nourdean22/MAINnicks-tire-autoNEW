/**
 * tests/components/chat-resume-regenerate-gate.test.tsx · task P2-B6 fix round 2.
 *
 * In ai@6 a resume rebuilds the reply from an empty message, and the resume
 * route replays text only. So after a Reconnect the bubble that showed a
 * side-effecting tool part is replaced by a text-only one, and the manual
 * Regenerate gate (turnHasSideEffect, which reads parts) offered a replay
 * that can fire the tool a second time. The same holds for a mount-time
 * resume of an in-flight turn: its bubble is built from the replay alone.
 *
 * Driven end to end at the CONSUMER: the REAL transport inside the REAL
 * @ai-sdk/react Chat produces the message, and the REAL ChatMessageList
 * decides whether to render Regenerate. Only the network is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { Chat } from "@ai-sdk/react";
import type { DefaultChatTransport, UIMessage } from "ai";
import { useChatTransport, type ChatUIMessage } from "@/hooks/chat/use-chat-transport";
import { bindPersistedMessage } from "@/features/chat-v2/lib/turn-lifecycle";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: unknown; children: React.ReactNode }) => <a href={String(href)}>{children}</a>,
}));
vi.mock("@/lib/trpc/client", () => {
  const hookLeaf = {
    useMutation: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false }),
    useQuery: () => ({ data: undefined, isLoading: false }),
  };
  const procProxy = new Proxy({}, { get: () => hookLeaf });
  const routerProxy = new Proxy({}, { get: (_t, prop) => (prop === "useUtils" ? () => ({}) : procProxy) });
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

function build(lastTraceId: string | null, resumeIntoMessageId?: () => string | undefined) {
  let transport: DefaultChatTransport<ChatUIMessage> | undefined;
  function Probe() {
    transport = useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: { current: { conversationId: "c1" } },
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      lastTraceIdRef: { current: lastTraceId },
      setDeeperContext: () => {},
      resumeIntoMessageId,
    } as never);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return transport!;
}

/** A plain UI-message SSE body: what the resume route (and the image lane) sends. */
function textBody(messageId: string, text: string): Response {
  const part = `${messageId}-text`;
  const frames = [
    { type: "start", messageId },
    { type: "text-start", id: part },
    { type: "text-delta", id: part, delta: text },
    { type: "text-end", id: part },
    { type: "finish" },
  ]
    .map((c) => `data: ${JSON.stringify(c)}\n\n`)
    .concat("data: [DONE]\n\n")
    .join("");
  return new Response(frames, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const regenerateButtons = (messages: ChatUIMessage[]) =>
  renderToStaticMarkup(
    <ChatMessageList
      messages={messages as UIMessage[]}
      isLoading={false}
      error={undefined}
      onRetry={() => {}}
      tts={{ supported: false } as never}
    />,
  ).split('aria-label="Regenerate reply"').length - 1;

const user: ChatUIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "text Brennen a quote" }] };
// createQuickQuote is flagged sideEffecting in TOOL_CATALOG.
const stalledToolTurn = (): ChatUIMessage[] => [
  user,
  {
    id: "live-1",
    role: "assistant",
    parts: [
      { type: "tool-createQuickQuote", toolCallId: "t1", state: "output-available", input: {}, output: {} },
      { type: "text", text: "Sent the" },
    ],
  } as ChatUIMessage,
];

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("a resumed bubble never offers Regenerate", () => {
  it("Reconnect replaces the tool turn's bubble with replayed text: Regenerate stays refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textBody("resume-c1-T1", "Sent the quote.")));
    const chat = new Chat<ChatUIMessage>({
      id: "t",
      transport: build("T1", () => "live-1"),
      messages: stalledToolTurn(),
    });
    expect(regenerateButtons(chat.messages), "before: the tool part refuses it").toBe(0);

    await chat.resumeStream();

    expect(chat.messages.map((m) => m.id)).toEqual(["u1", "live-1"]);
    expect(regenerateButtons(chat.messages)).toBe(0);
  });

  it("the refusal survives the DB-id binding every completed resume goes through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textBody("resume-c1-T1", "Sent the quote.")));
    const chat = new Chat<ChatUIMessage>({
      id: "t",
      transport: build("T1", () => "live-1"),
      messages: stalledToolTurn(),
    });
    await chat.resumeStream();

    const bound = bindPersistedMessage(chat.messages, { id: "db-1", content: "Sent the quote." });

    expect(bound.at(-1)?.id).toBe("db-1");
    expect(regenerateButtons(bound)).toBe(0);
  });

  it("a mount-time resume (names no turn) builds its bubble from the replay alone: refused too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textBody("resume-c1-T1", "Sent the quote.")));
    const chat = new Chat<ChatUIMessage>({ id: "t", transport: build(null), messages: [user] });

    await chat.resumeStream();

    expect(chat.messages.map((m) => m.id)).toEqual(["u1", "resume-c1-T1"]);
    expect(regenerateButtons(chat.messages)).toBe(0);
  });

  it("CONTROL: a text-only reply that streamed live (POST) still offers Regenerate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textBody("srv-1", "All green.")));
    const chat = new Chat<ChatUIMessage>({ id: "t", transport: build(null), messages: [] });

    await chat.sendMessage({ text: "status?" });

    expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(regenerateButtons(chat.messages)).toBe(1);
  });
});
