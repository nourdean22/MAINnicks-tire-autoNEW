/**
 * Image lane · a disconnect during generation must not lose the row
 * (audit 04-F16, 2026-10-10).
 *
 * The paid image call resolved, then the handler ENQUEUED to the stream
 * before persisting. With the client gone, enqueue throws; the throw jumped
 * to the error branch, whose own enqueue threw again before ITS persist —
 * so neither the image row nor an error row was written, and the image the
 * operator paid for vanished from history.
 *
 * Now the row is written first, and enqueue on a closed stream is a no-op.
 * (A private turn never gets here: the handler refuses at the top, pinned in
 * private-mode-zero-persist.test.ts.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  generate: vi.fn(),
  recordError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { create: (a: unknown) => h.create(a) },
    chatConversation: { update: () => Promise.resolve({}) },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: h.recordError }));
vi.mock("@/lib/ai/gemini-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/gemini-image")>();
  return { ...actual, generateImageWithFallback: h.generate };
});

import { handleImage } from "@/lib/ai/chat/handlers/image";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const IMG = { imageId: "img1", imageUrl: "/api/images/img1", model: "flux", size: "1024x1024", prompt: "p" };

beforeEach(() => {
  vi.clearAllMocks();
  h.create.mockResolvedValue({ id: "row" });
});

async function disconnectThenSettle(settle: (d: ReturnType<typeof deferred<typeof IMG>>) => void) {
  const gen = deferred<typeof IMG>();
  h.generate.mockReturnValue(gen.promise);
  const res = await handleImage("conv-1", "/img a red barn", true);
  const reader = res.body!.getReader();
  await reader.read(); // placeholder arrived
  await reader.cancel(); // client gone mid-generation
  settle(gen);
  await new Promise((r) => setTimeout(r, 20));
}

describe("image lane · disconnect during generation", () => {
  it("the generated image row is still written", async () => {
    await disconnectThenSettle((g) => g.resolve(IMG));
    expect(h.create).toHaveBeenCalledTimes(1);
    const data = (h.create.mock.calls[0]![0] as { data: { streamingState: string; content: string } }).data;
    expect(data.streamingState).toBe("complete");
    expect(data.content).toContain("/api/images/img1");
    // ...and the success was not mis-recorded as an image-gen failure.
    expect(h.recordError).not.toHaveBeenCalledWith("chat:image-gen", expect.anything(), expect.anything());
  });

  it("a failed generation still writes its error row", async () => {
    await disconnectThenSettle((g) => g.reject(new Error("provider down")));
    expect(h.create).toHaveBeenCalledTimes(1);
    const data = (h.create.mock.calls[0]![0] as { data: { streamingState: string } }).data;
    expect(data.streamingState).toBe("errored");
  });

  it("CONTROL: an attached client gets the image streamed and exactly one row", async () => {
    h.generate.mockResolvedValue(IMG);
    const text = await (await handleImage("conv-1", "/img a red barn", true)).text();
    expect(text).toContain("/api/images/img1");
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});
