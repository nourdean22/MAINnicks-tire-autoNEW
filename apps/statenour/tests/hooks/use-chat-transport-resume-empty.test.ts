/**
 * tests/hooks/use-chat-transport-resume-empty.test.ts - review R3 wave A finding 2, task R3-15.
 *
 * ai@6 turns a resume that answers 204 into status "ready" with no error, so a
 * network-kill resume that finds nothing erased the error card and the turn
 * looked finished. The transport is the only place that sees the 204; it now
 * reports it. Same capture technique as use-chat-transport-b6.test.ts.
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

type Wrapper = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function build(onResumeEmpty: () => void): Wrapper {
  capturedOpts = undefined;
  function Probe() {
    useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: { current: { conversationId: "c1" } },
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      lastTraceIdRef: { current: "T1" },
      setDeeperContext: () => {},
      onResumeEmpty,
    } as never);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!capturedOpts) throw new Error("transport opts were not captured");
  return capturedOpts.fetch as Wrapper;
}

const resumeUrl = "/api/ai/chat/c1/stream?traceId=T1";

describe("a resume that finds nothing is reported", () => {
  it("a resume GET answered 204 calls onResumeEmpty once", async () => {
    const onResumeEmpty = vi.fn();
    const wrapped = build(onResumeEmpty);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    try {
      await wrapped(resumeUrl, { method: "GET" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(onResumeEmpty).toHaveBeenCalledTimes(1);
    expect(onResumeEmpty).toHaveBeenCalledWith({ pending: false });
  });

  it("a 204 carrying X-Resume-Pending (turn alive, no bytes yet) says so", async () => {
    const onResumeEmpty = vi.fn();
    const wrapped = build(onResumeEmpty);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204, headers: { "X-Resume-Pending": "1" } })));
    try {
      await wrapped(resumeUrl, { method: "GET" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(onResumeEmpty).toHaveBeenCalledWith({ pending: true });
  });

  it("CONTROL: a resume that streams, and a POST, report nothing", async () => {
    const onResumeEmpty = vi.fn();
    const wrapped = build(onResumeEmpty);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("data: {}\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } })),
    );
    try {
      await wrapped(resumeUrl, { method: "GET" });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
      await wrapped("/api/ai/chat", { method: "POST" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(onResumeEmpty).not.toHaveBeenCalled();
  });
});

// Round 2 review (2026-10-25): Nour's stalled turn was the FIRST message of a new chat, so the
// client had no conversation id and every resume went to the "none" sentinel (a 204 by contract).
function buildWith(extra: Record<string, unknown>, body: Record<string, unknown>, trace: { current: string | null }) {
  capturedOpts = undefined;
  function Probe() {
    useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: { current: body },
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      lastTraceIdRef: trace,
      setDeeperContext: () => {},
      ...extra,
    } as never);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!capturedOpts) throw new Error("transport opts were not captured");
  return capturedOpts as {
    prepareReconnectToStreamRequest: () => { api: string };
    fetch: Wrapper;
  };
}

describe("a first-send reattach names the message it waits for", () => {
  it("no conversation yet: the resume carries the client-minted message id", () => {
    const t = buildWith({ resumeUserMessageId: () => "u1" }, { conversationId: null }, { current: null });
    expect(t.prepareReconnectToStreamRequest().api).toBe("/api/ai/chat/none/stream?clientMessageId=u1");
  });

  it("CONTROL: private mode never sends it, and a known conversation keeps its plain URL", () => {
    const priv = buildWith({ resumeUserMessageId: () => "u1" }, { conversationId: null, privateMode: true }, { current: null });
    expect(priv.prepareReconnectToStreamRequest().api).toBe("/api/ai/chat/none/stream");
    const known = buildWith({ resumeUserMessageId: () => "u1" }, { conversationId: "c1" }, { current: "T2" });
    expect(known.prepareReconnectToStreamRequest().api).toBe("/api/ai/chat/c1/stream?traceId=T2");
  });

  it("CONSUMER: a pending 204's trace and conversation reach the client, so the next GET names both", async () => {
    const trace = { current: null as string | null };
    const onConversationId = vi.fn();
    const onResumeEmpty = vi.fn();
    const t = buildWith({ onConversationId, onResumeEmpty }, { conversationId: null }, trace);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, { status: 204, headers: { "X-Resume-Pending": "1", "X-Trace-Id": "T2", "X-Conversation-Id": "conv-new" } }),
      ),
    );
    try {
      await t.fetch("/api/ai/chat/none/stream?clientMessageId=u1", { method: "GET" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(onResumeEmpty).toHaveBeenCalledWith({ pending: true });
    expect(trace.current).toBe("T2");
    expect(onConversationId).toHaveBeenCalledWith("conv-new");
  });
});
