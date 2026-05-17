/**
 * lib/streaming/heartbeat.ts — B4 guards.
 *
 * Covers the properties the chat route relies on:
 *   1. Upstream bytes reach the consumer unchanged
 *   2. Pings interleave at the configured cadence
 *   3. cancel() tears down timer + upstream reader (no leaks)
 *   4. Missing upstream doesn't crash; ping-only mode works
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withHeartbeat } from "@/lib/streaming/heartbeat";

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decode(u: Uint8Array): string {
  return new TextDecoder().decode(u);
}

describe("withHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes upstream bytes through unchanged", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode("data: hello\n\n"));
        controller.enqueue(encode("data: world\n\n"));
        controller.close();
      },
    });

    // Disable leading ping to keep the assertion simple.
    const wrapped = withHeartbeat(upstream, 60_000, { leadingPing: false });
    const reader = wrapped.getReader();
    const chunks: string[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(decode(value));
    }
    expect(chunks.join("")).toBe("data: hello\n\ndata: world\n\n");
  });

  it("emits a leading ping immediately by default", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Keep upstream open so we can read the leading ping first.
        setTimeout(() => {
          controller.enqueue(encode("data: body\n\n"));
          controller.close();
        }, 100);
      },
    });

    const wrapped = withHeartbeat(upstream, 60_000);
    const reader = wrapped.getReader();
    const first = await reader.read();
    // First chunk MUST be the leading ping (SSE comment).
    expect(decode(first.value!).startsWith(": ping-")).toBe(true);
    await reader.cancel();
  });

  it("cancel() tears down the interval timer", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      // Never closes — simulates a long AI stream.
      start() {},
    });

    const wrapped = withHeartbeat(upstream, 1_000);
    const reader = wrapped.getReader();

    // Drain the leading ping so start() has progressed past its
    // setInterval call.
    await reader.read();

    // Spy on clearInterval to observe teardown.
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    await reader.cancel();

    // The wrapper's teardown should have cleared its internal timer.
    // (It may also clear other timers; we only care that ours fires.)
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("handles null upstream without crashing (ping-only mode)", async () => {
    const wrapped = withHeartbeat(null, 1_000);
    const reader = wrapped.getReader();

    const first = await reader.read();
    expect(decode(first.value!).startsWith(": ping-")).toBe(true);

    // Advance virtual time and confirm another ping arrives.
    vi.advanceTimersByTime(1_100);
    const second = await reader.read();
    expect(decode(second.value!).startsWith(": ping-")).toBe(true);

    await reader.cancel();
  });
});
