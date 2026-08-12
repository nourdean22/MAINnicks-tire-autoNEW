/**
 * streamingStateForFinish tests (lib/services/chat/persist-assistant-message.ts).
 *
 * Pins the finishReason → persisted streamingState vocabulary, including
 * the 2026-08-11 "refused" state: Claude 5-family stop_reason "refusal"
 * arrives as finishReason "content-filter" and must persist as a
 * distinct honest state — not "unknown" (reads as an outage), and not
 * "errored" (would be neutralized by sanitize-history and mislabel a
 * model decision as a provider failure).
 */

import { describe, it, expect } from "vitest";
import { streamingStateForFinish } from "@/lib/services/chat/persist-assistant-message";

describe("streamingStateForFinish", () => {
  it("maps the incumbent vocabulary unchanged", () => {
    expect(streamingStateForFinish("stop")).toBe("complete");
    expect(streamingStateForFinish("tool-calls")).toBe("complete");
    expect(streamingStateForFinish("error")).toBe("errored");
    expect(streamingStateForFinish("length")).toBe("truncated");
    expect(streamingStateForFinish(undefined)).toBe("unknown");
    expect(streamingStateForFinish("something-new")).toBe("unknown");
  });

  it("maps content-filter (Claude 5 refusal) to the distinct refused state", () => {
    expect(streamingStateForFinish("content-filter")).toBe("refused");
  });

  it("refused is neither errored nor unknown — the two dishonest labels", () => {
    const state = streamingStateForFinish("content-filter");
    expect(state).not.toBe("errored");
    expect(state).not.toBe("unknown");
  });
});
