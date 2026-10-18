/**
 * Home "Ask Nick" box round trip (2026-10-18).
 *
 * THE BUG. POST /api/ai/chat always answers in the cockpit SSE format
 * (lib/ai/runtime/sse-stream.ts: named `event:` frames, base64 `event: chunk`
 * payloads). The command line used a bare DefaultChatTransport, so the AI SDK
 * parser threw on the first named frame, useChat went to "error", and the box
 * never read `error`: Nour saw only "You: ..." and silence while the server ran
 * every turn to completion.
 *
 * The other command-line tests mock useChat, so they could not see it. These
 * drive the REAL component, the REAL @ai-sdk/react useChat and the REAL server
 * wrapper (createCockpitSseStream inside withHeartbeat, as response-shape.ts
 * builds it). Only global fetch is stubbed.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createUIMessageStream, JsonToSseTransformStream, type UIMessageChunk } from "ai";
import { createCockpitSseStream } from "@/lib/ai/runtime/sse-stream";
import { withHeartbeat } from "@/lib/streaming/heartbeat";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: { operator: { nickRemembersContext: { useQuery: () => ({ data: undefined }) } } },
}));

import { NickCommandLine } from "@/components/home/nick-command-line";

const WORKING = "Nick is working...";
const SLOW = "Still working. This one is slow.";
const NO_ANSWER = "Nick did not answer. Your message is still above. Try again.";

/** The raw AI SDK UI-message stream bytes, made by the SDK's own producer. */
function aiSdkBytes(chunks: UIMessageChunk[], opts: { throwAfter?: boolean } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return createUIMessageStream({
    execute: ({ writer }) => {
      for (const c of chunks) writer.write(c);
      if (opts.throwAfter) throw new Error("provider stream broke");
    },
    onError: () => "stream broke",
  })
    .pipeThrough(new JsonToSseTransformStream())
    .pipeThrough(new TransformStream<string, Uint8Array>({ transform: (s, c) => c.enqueue(encoder.encode(s)) }));
}

const textTurn = (text: string): UIMessageChunk[] => [
  { type: "start" },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: text },
  { type: "text-end", id: "t1" },
  { type: "finish" },
];

/** What the chat route sends: the cockpit wrapper around the AI SDK bytes, with heartbeat pings. */
function cockpitResponse(aiSdkStream: ReadableStream<Uint8Array>): Response {
  const body = withHeartbeat(
    createCockpitSseStream({
      aiSdkStream,
      traceId: "trace-test-1",
      classification: { intent: "general_chat", mode: "fast", model: "test-model", provider: "test", targets: [] },
      recalledMemories: [],
      contradictions: [],
      onFinishPromise: Promise.resolve(),
    }),
  );
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "X-Trace-Id": "trace-test-1" },
  });
}

let container: HTMLDivElement;
let root: Root;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<NickCommandLine />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const text = () => container.textContent ?? "";

function typeInto(value: string) {
  const ta = container.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function send(value: string) {
  typeInto(value);
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
}

/** Real timers only: let the stream and React settle until `pred` holds. */
async function until(pred: () => boolean, label: string) {
  for (let i = 0; i < 400; i++) {
    if (pred()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error(`timed out waiting for ${label}; DOM text: ${text()}`);
}

describe("NickCommandLine round trip through the real cockpit stream", () => {
  it("T1: Nick's reply renders when the server answers in the cockpit SSE format", async () => {
    const fetchMock = vi.fn().mockResolvedValue(cockpitResponse(aiSdkBytes(textTurn("Ship the brief first."))));
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await send("plan my day");
    await until(() => text().includes("Ship the brief first.") || text().includes(NO_ANSWER), "a reply or an error");

    expect(text()).toContain("Ship the brief first.");
    expect(text()).not.toContain(NO_ANSWER);
    expect(text()).not.toContain(WORKING);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/ai/chat");
    expect(JSON.parse(String(init.body)).ephemeral).toBe(true);
  });
});

describe("NickCommandLine error state", () => {
  it("T2a: a 503 shows the no-answer line, and Try again re-sends once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(cockpitResponse(aiSdkBytes(textTurn("Second try worked."))));
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await send("plan my day");
    await until(() => text().includes(NO_ANSWER), "the no-answer line");
    expect(text()).toContain("You: plan my day");

    await act(async () => button("Try again")!.click());
    await until(() => text().includes("Second try worked."), "the retried reply");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).messages.at(-1).parts[0].text).toBe("plan my day");
    // The failed turn is replaced, not repeated.
    expect(text().split("You: plan my day").length - 1).toBe(1);
    expect(text()).not.toContain(NO_ANSWER);
  });

  it("T2b: a network rejection shows the no-answer line, and Try again re-sends", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(cockpitResponse(aiSdkBytes(textTurn("Back online."))));
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await send("hi");
    await until(() => text().includes(NO_ANSWER), "the no-answer line");
    await act(async () => button("Try again")!.click());
    await until(() => text().includes("Back online."), "the retried reply");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("T2c: a stream that finished with no assistant text is a no-answer, not silence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(cockpitResponse(aiSdkBytes([{ type: "start" }, { type: "finish" }]))));
    mount();
    await send("hi");
    await until(() => text().includes(NO_ANSWER), "the no-answer line");
    expect(button("Try again")).toBeDefined();
  });

  it("T2d: a turn that broke after a write tool ran offers no Try again (a re-send could run it twice)", async () => {
    const chunks: UIMessageChunk[] = [
      { type: "start" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "someUnknownWriter", input: {} },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(cockpitResponse(aiSdkBytes(chunks, { throwAfter: true }))));
    mount();
    await send("/task call the supplier");
    await until(() => text().includes("Nick did not finish"), "the did-not-finish line");
    expect(button("Try again")).toBeUndefined();
  });
});

describe("NickCommandLine working state", () => {
  it("T3: says working at once, says slow after 20 s, and clears when the reply lands", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let resolveFetch: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolveFetch = r))));
    mount();
    await send("scrape the supplier page");
    await act(async () => {
      await Promise.resolve();
    });

    const status = () => container.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? "";
    expect(status()).toContain(WORKING);
    await act(async () => {
      vi.advanceTimersByTime(19_999);
    });
    expect(status()).toContain(WORKING);
    expect(status()).not.toContain(SLOW);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(status()).toContain(SLOW);

    vi.useRealTimers();
    resolveFetch(cockpitResponse(aiSdkBytes(textTurn("Here is the page."))));
    await until(() => text().includes("Here is the page."), "the reply");
    expect(status()).not.toContain(WORKING);
    expect(status()).not.toContain(SLOW);
  });
});
