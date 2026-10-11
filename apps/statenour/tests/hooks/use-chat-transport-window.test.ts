/**
 * Long threads, client half (audit 04-F15, 2026-10-10).
 *
 * The chat route refuses a body with more than 200 messages, and the client
 * sent its whole history on every turn, so message 201 and every send after
 * it failed with a 400. The transport now sends the last 150 messages and
 * `historyOffset` = how many older ones it left out; the server's summary
 * cache uses that offset to stay aligned (tests/ai/conversation-compress-window).
 *
 * Drives the REAL prepareSendMessagesRequest the hook hands to
 * DefaultChatTransport (capture pattern from use-chat-transport-b6.test.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

let capturedOpts: Record<string, unknown> | undefined;

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(opts: Record<string, unknown>) {
      capturedOpts = opts;
    }
  },
}));

import { useChatTransport } from "@/hooks/chat/use-chat-transport";

type Prepare = (o: {
  id: string;
  messages: Array<{ id: string }>;
  body: Record<string, unknown>;
  trigger: string;
  messageId: string | undefined;
}) => { body: Record<string, unknown> };

function prepare(): Prepare {
  capturedOpts = undefined;
  function Probe() {
    useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: { current: {} },
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      setDeeperContext: () => {},
    } as never);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  const fn = capturedOpts?.prepareSendMessagesRequest;
  if (typeof fn !== "function") throw new Error("prepareSendMessagesRequest was not set");
  return fn as Prepare;
}

const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }));

describe("useChatTransport - send window", () => {
  it("a 250-message thread sends the last 150 with historyOffset 100", () => {
    const { body } = prepare()({
      id: "chat-v2",
      messages: msgs(250),
      body: { conversationId: "conv-1", privateMode: false },
      trigger: "submit-message",
      messageId: undefined,
    });
    const sent = body.messages as Array<{ id: string }>;
    expect(sent).toHaveLength(150);
    expect(sent[0]!.id).toBe("m100");
    expect(sent.at(-1)!.id).toBe("m249");
    expect(body.historyOffset).toBe(100);
  });

  it("keeps everything the default body carried (the page's fields, id, trigger, messageId)", () => {
    const { body } = prepare()({
      id: "chat-v2",
      messages: msgs(3),
      body: { conversationId: "conv-1", posture: "auto" },
      trigger: "regenerate-message",
      messageId: "m2",
    });
    expect(body).toMatchObject({
      conversationId: "conv-1",
      posture: "auto",
      id: "chat-v2",
      trigger: "regenerate-message",
      messageId: "m2",
      historyOffset: 0,
    });
    expect(body.messages).toHaveLength(3);
  });
});
