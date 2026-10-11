/**
 * tests/hooks/use-chat-transport-resume-merge.test.ts · task P2-B6 item 1.
 *
 * Reconnect duplicated the reply. After the 90s stall abort the stalled
 * bubble keeps its live id; tapping Reconnect resumes, the route answers
 * under `resume-<conv>-<trace>`, and the AI SDK (ai@6, resume starts from an
 * empty message) pushes a second bubble because the ids differ.
 *
 * Driven end to end: the REAL fetch wrapper from useChatTransport inside a
 * REAL DefaultChatTransport, consumed by the REAL @ai-sdk/react Chat. Only
 * the network is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Chat } from "@ai-sdk/react";
import type { DefaultChatTransport } from "ai";
import { useChatTransport, type ChatUIMessage } from "@/hooks/chat/use-chat-transport";

function build(opts: { lastTraceId?: string | null; resumeIntoMessageId?: () => string | undefined }) {
  let transport: DefaultChatTransport<ChatUIMessage> | undefined;
  const traceRef = { current: opts.lastTraceId ?? null };
  function Probe() {
    transport = useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: { current: { conversationId: "c1" } },
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      lastTraceIdRef: traceRef,
      setDeeperContext: () => {},
      resumeIntoMessageId: opts.resumeIntoMessageId,
    } as never);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return { transport: transport!, traceRef };
}

/** What the resume route sends for a turn: a plain UI-message SSE body. */
function resumeBody(messageId: string, text: string): Response {
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

const textOf = (m: ChatUIMessage) =>
  m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

const stalled = (): ChatUIMessage[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "question" }] },
  { id: "live-1", role: "assistant", parts: [{ type: "text", text: "the first half" }] },
];

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("a named resume merges into the bubble already showing its turn", () => {
  it("Reconnect after a stall: one assistant bubble, same id, full replayed text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resumeBody("resume-c1-T1", "the first half and the rest"));
    vi.stubGlobal("fetch", fetchMock);
    const { transport } = build({ lastTraceId: "T1", resumeIntoMessageId: () => "live-1" });
    const chat = new Chat<ChatUIMessage>({ id: "t", transport, messages: stalled() });

    await chat.resumeStream();

    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/chat/c1/stream?traceId=T1");
    expect(chat.messages.map((m) => m.id)).toEqual(["u1", "live-1"]);
    expect(textOf(chat.messages[1])).toBe("the first half and the rest");
  });

  it("CONTROL: a resume that names no turn (mount) keeps the server id, so it can never replace an older reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resumeBody("resume-c1-T1", "in-flight reply")));
    const resumeInto = vi.fn(() => "older-reply");
    const { transport } = build({ lastTraceId: null, resumeIntoMessageId: resumeInto });
    const chat = new Chat<ChatUIMessage>({ id: "t", transport, messages: stalled() });

    await chat.resumeStream();

    expect(chat.messages.map((m) => m.id)).toEqual(["u1", "live-1", "resume-c1-T1"]);
    expect(resumeInto).not.toHaveBeenCalled();
  });

  it("CONTROL: no bubble for the turn yet (stall before the first token) appends the reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resumeBody("resume-c1-T1", "reply")));
    const { transport } = build({ lastTraceId: "T1", resumeIntoMessageId: () => undefined });
    const chat = new Chat<ChatUIMessage>({ id: "t", transport, messages: stalled().slice(0, 1) });

    await chat.resumeStream();

    expect(chat.messages.map((m) => m.id)).toEqual(["u1", "resume-c1-T1"]);
  });
});

describe("a turn with no trace does not leave the previous turn's trace behind", () => {
  it("a POST answered without X-Trace-Id (image, confirmation lanes) clears the trace a resume would name", async () => {
    const { transport, traceRef } = build({ lastTraceId: "T-prev" });
    const wrapper = (transport as unknown as { fetch: typeof fetch }).fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    await wrapper("/api/ai/chat", { method: "POST", body: "{}" });

    expect(traceRef.current).toBeNull();
  });

  it("CONTROL: a POST that carries X-Trace-Id records it", async () => {
    const { transport, traceRef } = build({ lastTraceId: "T-prev" });
    const wrapper = (transport as unknown as { fetch: typeof fetch }).fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "X-Trace-Id": "T2" } })),
    );

    await wrapper("/api/ai/chat", { method: "POST", body: "{}" });

    expect(traceRef.current).toBe("T2");
  });

  it("CONTROL: a resume GET without the header leaves the trace alone", async () => {
    const { transport, traceRef } = build({ lastTraceId: "T1" });
    const wrapper = (transport as unknown as { fetch: typeof fetch }).fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await wrapper("/api/ai/chat/c1/stream?traceId=T1", { method: "GET" });

    expect(traceRef.current).toBe("T1");
  });
});
