/**
 * tests/hooks/use-chat-transport.test.ts · de-Venice control-plane lock.
 *
 * Locks the conversation-id round-trip: the transport's fetch wrapper
 * MUST read `X-Conversation-Id` off the response headers and fire
 * `onConversationId(id)` so the page can echo it back on the next
 * send. Without this, every send spawns a fresh 2-message conversation
 * (the prod bug fixed 2026-04-22).
 *
 * ── How this is unit-tested without a live useChat / DOM ──────────────
 * The wrapper is the `fetch` option passed to `new DefaultChatTransport`.
 * The hook builds that transport via useMemo. We mock the `ai` module's
 * DefaultChatTransport with a capture-spy so we can grab the exact
 * `fetch` wrapper the hook constructs, then invoke it directly with a
 * stubbed global.fetch. That exercises the real header-read + callback
 * path. We use a non-SSE response (no text/event-stream content-type)
 * so the wrapper skips the streaming branch and returns synchronously.
 *
 * vitest env is Node — Response/Headers are available on Node 18+, and
 * the hook is driven via react-dom/server (no jsdom needed) to run the
 * useMemo body for real.
 *
 * NOTE (flagged to the author): we deliberately invoke the CAPTURED
 * wrapper rather than the transport's public API, because
 * DefaultChatTransport offers no clean public entrypoint to trigger its
 * internal fetch in isolation. Capturing the constructor arg is the
 * least-mocking way to assert the real wrapper logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, createRef } from "react";

// Capture the `fetch` wrapper the hook hands to DefaultChatTransport.
let capturedFetch:
  | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)
  | undefined;

vi.mock("ai", () => ({
  // Minimal stand-in: record the opts so the test can pull the wrapper.
  DefaultChatTransport: class {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      capturedFetch = opts.fetch as typeof capturedFetch;
    }
  },
}));

import { useChatTransport } from "@/hooks/chat/use-chat-transport";

/**
 * Drive the hook once so its useMemo runs and constructs the (mocked)
 * transport, capturing the fetch wrapper. Returns the callback spy +
 * the captured wrapper.
 */
function buildTransport(onConversationId: (id: string) => void) {
  capturedFetch = undefined;

  function Probe() {
    useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: createRef() as never,
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      setDeeperContext: () => {},
      onConversationId,
    });
    return null;
  }
  // No JSX — this is a .ts file. createElement keeps esbuild happy
  // while still running the hook's useMemo body for real.
  renderToStaticMarkup(createElement(Probe));

  if (!capturedFetch) throw new Error("transport fetch wrapper was not captured");
  return capturedFetch;
}

beforeEach(() => {
  capturedFetch = undefined;
  vi.restoreAllMocks();
});

describe("useChatTransport · conversation-id re-injection", () => {
  it("fires onConversationId with the X-Conversation-Id header value", async () => {
    const onConversationId = vi.fn();
    const wrapper = buildTransport(onConversationId);

    // Non-SSE response carrying the conversation id. content-type is
    // not text/event-stream, so the wrapper takes the fast path and
    // returns the response after reading headers.
    const stubbed = new Response("", {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Conversation-Id": "conv_123" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stubbed));

    const res = await wrapper("/api/ai/chat", {});
    expect(onConversationId).toHaveBeenCalledWith("conv_123");
    expect(onConversationId).toHaveBeenCalledTimes(1);
    // The wrapper still returns the response untouched on the fast path.
    expect(res.status).toBe(200);
  });

  it("does not fire (and does not throw) when the header is absent", async () => {
    const onConversationId = vi.fn();
    const wrapper = buildTransport(onConversationId);

    const stubbed = new Response("", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stubbed));

    await expect(wrapper("/api/ai/chat", {})).resolves.toBeInstanceOf(Response);
    expect(onConversationId).not.toHaveBeenCalled();
  });
});
