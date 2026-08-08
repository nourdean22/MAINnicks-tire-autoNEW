import { describe, it, expect } from "vitest";
import { buildChatResponse, type BuildChatResponseInput } from "@/lib/services/chat/response-shape";

// buildChatResponse is the single place the main chat stream's Response is
// assembled (route.ts hands it result.toUIMessageStreamResponse()). These
// tests pin the SSE header contract by BUILDING a response and reading the
// real Headers object — not by matching source text.

function closedUpstream(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function makeInput(overrides: Partial<BuildChatResponseInput> = {}): BuildChatResponseInput {
  return {
    streamResponse: closedUpstream(),
    convId: "conv_123",
    traceId: "trace_abc",
    mode: "standard" as BuildChatResponseInput["mode"],
    personality: "operator",
    turnSignal: {
      complexity: "simple",
      intent: "chat",
      outputShape: "prose",
      urgency: "normal",
      temperature: 0.7,
    },
    deeperContextCount: 0,
    deeperContextTypes: [],
    contextBlocksFired: {
      recall: false,
      skills: false,
      identity: false,
      ghost: false,
      qualitative: false,
      beliefs: false,
      nudges: false,
      contradictions: false,
    },
    ...overrides,
  };
}

/** Read the body to completion so the heartbeat wrapper tears down its timer. */
async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("buildChatResponse · SSE header contract", () => {
  it("sets the full anti-buffering header set, including X-Accel-Buffering", async () => {
    const res = buildChatResponse(makeInput());

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("Connection")).toBe("keep-alive");
    // 2026-08-08 · the one header this builder was missing while the
    // sibling reason/stream route carried it. Without it an nginx-class
    // proxy may buffer the whole SSE body into a single burst.
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    const body = await drain(res);
    // Leading heartbeat ping proves the keep-alive mechanism is live on
    // the built stream (withHeartbeat enqueues it before upstream bytes).
    expect(body).toContain(": ping-");
  });

  it("exposes conversation + trace ids for the client transport", async () => {
    const res = buildChatResponse(makeInput());
    expect(res.headers.get("X-Conversation-Id")).toBe("conv_123");
    expect(res.headers.get("X-Trace-Id")).toBe("trace_abc");
    await drain(res);
  });

  it("blanks X-Conversation-Id for the private and temp sentinels", async () => {
    for (const sentinel of ["private", "temp"]) {
      const res = buildChatResponse(makeInput({ convId: sentinel }));
      expect(res.headers.get("X-Conversation-Id")).toBe("");
      await drain(res);
    }
  });
});
