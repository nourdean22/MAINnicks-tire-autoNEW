/**
 * The transport tells the chat hook when the server REFUSED a send on purpose (turn guard, 2026-10-15):
 * a 409/503 carrying X-Turn-Refusal. The hook needs that to stop treating the refusal as "the server
 * never answered". Drives the real fetch wrapper (capture technique of use-chat-transport-b6.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function build(onTurnRefused?: (info: { code: string; traceId: string | null }) => void) {
  capturedOpts = undefined;
  function Probe() {
    useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: { current: {} } as never,
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      lastTraceIdRef: { current: null },
      setDeeperContext: () => {},
      onTurnRefused,
    } as never);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!capturedOpts) throw new Error("transport opts were not captured");
  return capturedOpts.fetch as Wrapper;
}

const refusal = (headers: Record<string, string>, status = 409) =>
  new Response(JSON.stringify({ error: "Nick is still working on that message.", code: "turn_in_flight" }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("a refused send is reported to the hook", () => {
  it("a POST answered with X-Turn-Refusal calls onTurnRefused with the code and the trace of the run it hit", async () => {
    const onTurnRefused = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => refusal({ "X-Turn-Refusal": "turn_in_flight", "X-Trace-Id": "T1" })));

    const res = await build(onTurnRefused)("/api/ai/chat", { method: "POST" });

    expect(onTurnRefused).toHaveBeenCalledTimes(1);
    expect(onTurnRefused).toHaveBeenCalledWith({ code: "turn_in_flight", traceId: "T1" });
    expect(res.status, "the response goes on to the SDK unchanged").toBe(409);
  });

  it("a refusal with no trace header reports a null trace", async () => {
    const onTurnRefused = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => refusal({ "X-Turn-Refusal": "turn_unreadable" }, 503)));

    await build(onTurnRefused)("/api/ai/chat", { method: "POST" });

    expect(onTurnRefused).toHaveBeenCalledWith({ code: "turn_unreadable", traceId: null });
  });

  it("CONTROL - an ordinary POST, an error without the header, and a GET resume report nothing", async () => {
    const onTurnRefused = vi.fn();
    const wrapper = build(onTurnRefused);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200, headers: { "X-Trace-Id": "T2" } })));
    await wrapper("/api/ai/chat", { method: "POST" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    await wrapper("/api/ai/chat", { method: "POST" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204, headers: { "X-Turn-Refusal": "turn_in_flight" } })));
    await wrapper("/api/ai/chat/c1/stream", { method: "GET" });

    expect(onTurnRefused).not.toHaveBeenCalled();
  });

  it("a hook that passes no callback is not broken by a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => refusal({ "X-Turn-Refusal": "turn_answered", "X-Trace-Id": "T1" })));
    await expect(build(undefined)("/api/ai/chat", { method: "POST" })).resolves.toMatchObject({ status: 409 });
  });
});
