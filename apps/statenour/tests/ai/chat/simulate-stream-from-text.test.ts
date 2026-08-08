/**
 * tests/ai/chat/simulate-stream-from-text.test.ts · v10.0.507
 *
 * Locks the helper that converts a pre-computed string into a
 * UIMessageStreamResponse · the prerequisite for ADR-0011 Tier 2b
 * (pre-stream auto-regen winner-selection ship path).
 */
import { describe, it, expect } from "vitest";
import { simulateStreamFromText } from "@/lib/ai/chat/simulate-stream-from-text";

async function readSseBody(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  return body;
}

describe("simulateStreamFromText · v10.0.507", () => {
  it("returns a Response with SSE content-type", () => {
    const res = simulateStreamFromText({ text: "Hello." });
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // 2026-08-08 · anti-buffering parity — all SSE emit sites carry it.
    expect(res.headers.get("x-accel-buffering")).toBe("no");
  });

  it("emits text-start, text-delta, text-end chunks for a single message", async () => {
    const res = simulateStreamFromText({ text: "Hello world." });
    const body = await readSseBody(res);
    expect(body).toContain("text-start");
    expect(body).toContain("text-delta");
    expect(body).toContain("text-end");
    expect(body).toContain("Hello world.");
  });

  it("emits ONE delta when chunkSize is 0 (default)", async () => {
    const res = simulateStreamFromText({ text: "Single chunk." });
    const body = await readSseBody(res);
    // Count occurrences of "text-delta" in the SSE stream
    const deltaCount = (body.match(/text-delta/g) || []).length;
    expect(deltaCount).toBe(1);
  });

  it("emits multiple deltas when chunkSize is set", async () => {
    const text = "abcdefghij";
    const res = simulateStreamFromText({ text, chunkSize: 3 });
    const body = await readSseBody(res);
    const deltaCount = (body.match(/text-delta/g) || []).length;
    // 10 chars / 3 = ceil(10/3) = 4 chunks
    expect(deltaCount).toBe(4);
    expect(body).toContain("abc");
  });

  it("does not chunk when text is shorter than chunkSize", async () => {
    const res = simulateStreamFromText({ text: "short", chunkSize: 100 });
    const body = await readSseBody(res);
    const deltaCount = (body.match(/text-delta/g) || []).length;
    expect(deltaCount).toBe(1);
  });

  it("handles empty-string text gracefully", async () => {
    const res = simulateStreamFromText({ text: "" });
    expect(res).toBeInstanceOf(Response);
    const body = await readSseBody(res);
    expect(body).toContain("text-start");
    expect(body).toContain("text-end");
  });

  it("accepts a messageId option without erroring", async () => {
    // The AI SDK's generateId callback governs message-level IDs ·
    // the text-part-id we generate internally is independent. This
    // test verifies the option is accepted; whether it surfaces in
    // the wire format depends on AI SDK internals.
    const res = simulateStreamFromText({ text: "test", messageId: "msg-fixed-123" });
    expect(res).toBeInstanceOf(Response);
    const body = await readSseBody(res);
    expect(body).toContain("test");
  });

  it("emits the same text-part id across start/delta/end chunks", async () => {
    const res = simulateStreamFromText({ text: "consistent-id test" });
    const body = await readSseBody(res);
    // Extract the part id from text-start line
    const startMatch = body.match(/"type":"text-start","id":"([^"]+)"/);
    expect(startMatch).toBeTruthy();
    const partId = startMatch![1];
    // Same id should appear in text-delta and text-end
    expect(body).toContain(`"type":"text-delta","id":"${partId}"`);
    expect(body).toContain(`"type":"text-end","id":"${partId}"`);
  });
});
