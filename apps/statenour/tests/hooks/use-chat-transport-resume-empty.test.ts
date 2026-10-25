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
