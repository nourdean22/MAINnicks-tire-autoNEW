/**
 * POSITIVE CONTROL for the live Retry hole, against the real ai SDK on both sides.
 *
 * Fixture, the model stream of one turn:
 *   [start, text, error, tool-call createTask, finish(tool-calls), text]
 * Server side: streamText forwards the error part and keeps going, so the tool-call
 * and finish(tool-calls) after it still execute createTask. Client side: the SDK's
 * Chat rethrows on the error chunk, so the live bubble ends in the error state
 * holding only the text before it. The live gate (tool parts) therefore sees no
 * tool and says a replay is fine, while the server has already created the task.
 * That is why Retry in the error state reads the saved turn first
 * (features/chat-v2/hooks/use-chat-stream.ts), which tests/hooks/
 * use-chat-stream-glue.test.tsx pins.
 */
import { describe, it, expect } from "vitest";
import { Chat } from "@ai-sdk/react";
import { streamText, tool, type UIMessage, type UIMessageChunk } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { turnHasSideEffect } from "@/features/chat-v2/lib/turn-side-effect";

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };
const text = (id: string, delta: string) => [
  { type: "text-start", id },
  { type: "text-delta", id, delta },
  { type: "text-end", id },
];
const FIRST_STEP = [
  { type: "stream-start", warnings: [] },
  ...text("t1", "Working on it"),
  { type: "error", error: new Error("provider dropped mid-stream") },
  { type: "tool-call", toolCallId: "c1", toolName: "createTask", input: JSON.stringify({ title: "Call Mike" }) },
  { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
];
const SECOND_STEP = [{ type: "stream-start", warnings: [] }, ...text("t2", "Done."), { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage }];

const streamOf = (parts: unknown[]) =>
  new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });

async function runFixture() {
  let executed = 0;
  let call = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => ({ stream: streamOf(call++ === 0 ? FIRST_STEP : SECOND_STEP) }),
  });
  const createTask = tool({
    description: "Create a task",
    inputSchema: z.object({ title: z.string() }),
    execute: async () => {
      executed += 1;
      return { ok: true };
    },
  });
  const server = streamText({ model, prompt: "add a task", tools: { createTask }, maxRetries: 0 });
  // The same chunks the route's toUIMessageStreamResponse puts on the wire.
  const chunks = server.toUIMessageStream({ onError: () => "The AI provider dropped mid-response." });

  const chat = new Chat<UIMessage>({
    transport: {
      sendMessages: async () => chunks as ReadableStream<UIMessageChunk>,
      reconnectToStream: async () => null,
    },
  });
  await chat.sendMessage({ text: "add a task" });
  await server.consumeStream();
  return { chat, executed: () => executed };
}

describe("the live bubble after an in-band error part", () => {
  it("the server still runs the write after the error part", async () => {
    const { executed } = await runFixture();
    expect(executed()).toBe(1);
  });

  it("the client ends in the error state with the text before the error and NO tool part", async () => {
    const { chat } = await runFixture();

    expect(chat.status).toBe("error");
    const bubble = chat.messages.at(-1)!;
    expect(bubble.role).toBe("assistant");
    expect(bubble.parts.some((p) => p.type === "text")).toBe(true);
    expect(bubble.parts.some((p) => p.type.startsWith("tool-")), "the SDK showed the post-error tool").toBe(false);
  });

  it("so the live gate alone would allow the replay: the hole the saved-turn check closes", async () => {
    const { chat, executed } = await runFixture();

    expect(executed()).toBe(1);
    expect(turnHasSideEffect(chat.messages.at(-1) as UIMessage)).toBe(false);
  });
});
