import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// One-line note: This test is mostly independent of the devenice control plane changes and can go green immediately.

// Mock react to bypass hooks environment check by executing useMemo factory immediately
vi.mock("react", async () => {
  const actual = await vi.importActual("react") as any;
  return {
    ...actual,
    useMemo: (fn: () => any) => fn(),
  };
});

// Mock global window and window.dispatchEvent for Node environment
if (typeof window === "undefined") {
  global.window = {
    dispatchEvent: vi.fn(),
  } as any;
} else {
  vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
}

describe("useChatTransport conversation ID tracking", () => {
  const mockResponse = (headersObj: Record<string, string>, bodyStr: string = "") => {
    const headers = new Headers(headersObj);
    return {
      status: 200,
      statusText: "OK",
      headers,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(bodyStr) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    } as unknown as Response;
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("intercepts X-Conversation-Id header and calls onConversationId callback", async () => {
    const onConversationId = vi.fn();
    const transportBodyRef = { current: { messages: [] } };
    
    const fetchMock = vi.mocked(fetch).mockResolvedValue(
      mockResponse({ "X-Conversation-Id": "convo_12345" })
    );

    const { useChatTransport } = await import("../../hooks/chat/use-chat-transport");
    
    const transport = useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef,
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      setDeeperContext: vi.fn(),
      onConversationId,
    });

    // Invoke the transport fetch function
    const res = await (transport as any).fetch("/api/ai/chat", { method: "POST" });
    
    expect(fetchMock).toHaveBeenCalled();
    expect(onConversationId).toHaveBeenCalledWith("convo_12345");
    expect(res).toBeDefined();
  });

  it("does not throw when X-Conversation-Id header is missing", async () => {
    const onConversationId = vi.fn();
    const transportBodyRef = { current: { messages: [] } };
    
    const fetchMock = vi.mocked(fetch).mockResolvedValue(
      mockResponse({ "Content-Type": "text/plain" }, "Hello world")
    );

    const { useChatTransport } = await import("../../hooks/chat/use-chat-transport");
    
    const transport = useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef,
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      setDeeperContext: vi.fn(),
      onConversationId,
    });

    const res = await (transport as any).fetch("/api/ai/chat", { method: "POST" });
    
    expect(fetchMock).toHaveBeenCalled();
    expect(onConversationId).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

