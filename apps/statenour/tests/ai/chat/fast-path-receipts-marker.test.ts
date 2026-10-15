/**
 * Fast-path replies (brain dump, /save, a logged decision, a specialist route, a
 * generated image) write and then persist a complete row with no tool part and
 * no receipt. The Retry gate cannot tell that from a text-only reply, so a replay
 * duplicated the write (a second MasteryDecision, a second image). These replies
 * now say so: the row stores tokenUsage.receiptsUnavailable and the stream's
 * start chunk puts the same marker on the live bubble. The last test reads the
 * stream with the SDK's own parser and asks the real gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage } from "ai";

const h = vi.hoisted(() => ({ create: vi.fn(), generate: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { create: (a: unknown) => h.create(a) },
    chatConversation: { update: () => Promise.resolve({}) },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/ai/gemini-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/gemini-image")>();
  return { ...actual, generateImageWithFallback: h.generate };
});

import { buildFastStream } from "@/lib/ai/chat/handlers/shared";
import { handleImage } from "@/lib/ai/chat/handlers/image";
import { turnHasSideEffect } from "@/features/chat-v2/lib/turn-side-effect";

const IMG = { imageId: "img1", imageUrl: "/api/images/img1", model: "flux", size: "1024x1024", prompt: "p" };
const MARKER = { receiptsUnavailable: true };

const rowData = () => (h.create.mock.calls[0]![0] as { data: { tokenUsage?: unknown; streamingState: string } }).data;

async function startChunk(res: Response): Promise<Record<string, unknown>> {
  const text = await res.clone().text();
  const frame = text.split("\n\n").find((f) => f.includes('"type":"start"') && !f.includes("start-step"));
  return JSON.parse(frame!.replace(/^data: /, "")) as Record<string, unknown>;
}

async function liveMessage(res: Response): Promise<UIMessage> {
  const chunks = parseJsonEventStream({ stream: res.body!, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream({
      transform(parsed, controller) {
        if (parsed.success) controller.enqueue(parsed.value);
      },
    }),
  );
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream: chunks })) last = message;
  return last!;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.create.mockResolvedValue({ id: "row" });
});

describe("buildFastStream", () => {
  it("stores receiptsUnavailable on the row it persists", async () => {
    await buildFastStream("conv-1", "Logged the decision.", "dec", "nl-decision");

    expect(rowData().tokenUsage).toEqual(MARKER);
    expect(rowData().streamingState).toBe("complete");
  });

  it("puts the same marker on the bubble through the stream's start chunk", async () => {
    const res = await buildFastStream("conv-1", "Logged the decision.", "dec", "nl-decision");

    expect((await startChunk(res)).messageMetadata).toEqual(MARKER);
  });

  it("a turn with no conversation row still marks the live bubble", async () => {
    const res = await buildFastStream("temp", "Logged the decision.", "dec", "nl-decision");

    expect(h.create).not.toHaveBeenCalled();
    expect((await startChunk(res)).messageMetadata).toEqual(MARKER);
  });

  it("CONSUMER: read with the SDK's own parser, the bubble is one the Retry gate refuses", async () => {
    const res = await buildFastStream("conv-1", "Logged the decision.", "dec", "nl-decision");

    const message = await liveMessage(res);

    expect(message.parts.some((p) => p.type === "text")).toBe(true);
    expect((message.metadata as { receiptsUnavailable?: unknown } | undefined)?.receiptsUnavailable).toBe(true);
    expect(turnHasSideEffect(message)).toBe(true);
  });

  it("CONTROL: a plain model-style bubble (text only, no metadata) is not refused by the gate", async () => {
    const plain = { id: "m1", role: "assistant", parts: [{ type: "text", text: "Here is the plan." }] } as UIMessage;
    expect(turnHasSideEffect(plain)).toBe(false);
  });
});

describe("handleImage", () => {
  it("marks the generated-image row and the stream", async () => {
    h.generate.mockResolvedValue(IMG);

    const res = await handleImage("conv-1", "/img a red barn", true);
    await res.clone().text();

    expect(rowData().tokenUsage).toEqual(MARKER);
    expect(rowData().streamingState).toBe("complete");
    expect((await startChunk(res)).messageMetadata).toEqual(MARKER);
  });

  it("marks the failed-generation row too: the provider call may have been billed", async () => {
    h.generate.mockRejectedValue(new Error("provider down"));

    const res = await handleImage("conv-1", "/img a red barn", true);
    await res.clone().text();

    expect(rowData().tokenUsage).toEqual(MARKER);
    expect(rowData().streamingState).toBe("errored");
  });
});
