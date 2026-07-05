/**
 * Sanitize-history errored-stub neutralization · 2026-07-05 (audit P3 · c)
 *
 * Errored stub rows (streamingState "errored") now persist the bare
 * partial text so reload shows what the user saw — but that partial
 * must NOT replay to the model as genuine assistant speech: the model
 * would treat its own interrupted fragment as a completed answer and
 * compound from it. sanitizeMessageHistory neutralizes errored
 * assistant turns verifier-style (same mechanism as the v10.0.163
 * fabrication note): the turn survives with an explicit interruption
 * note instead of the partial text.
 */

import { describe, it, expect } from "vitest";
import { sanitizeMessageHistory } from "@/lib/ai/chat/sanitize-history";

interface Msg {
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
  streamingState?: string;
}

describe("sanitizeMessageHistory · errored-stub neutralization", () => {
  it("replaces an errored assistant turn's text with the interruption note", () => {
    const partial = "Here is the start of a detailed answer about Q3 that got cut";
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "how was Q3?" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: partial }],
        streamingState: "errored",
      },
      { role: "user", parts: [{ type: "text", text: "continue" }] },
    ];

    const out = sanitizeMessageHistory(msgs);

    const text = out[1].parts[0].text;
    expect(text).toMatch(/interrupted mid-stream/i);
    expect(text).not.toContain(partial);
    // Turn still exists — a hollow drop would hide the interruption
    // from the model entirely and orphan the user's "continue".
    expect(out[1].role).toBe("assistant");
  });

  it("leaves complete assistant turns untouched (by reference)", () => {
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "Hello, what can I help with?" }],
        streamingState: "complete",
      },
      { role: "user", parts: [{ type: "text", text: "next" }] },
    ];

    const out = sanitizeMessageHistory(msgs);

    expect(out[1]).toBe(msgs[1]);
    expect(out[1].parts[0].text).toBe("Hello, what can I help with?");
  });

  it("rows without streamingState metadata pass through unchanged", () => {
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      { role: "assistant", parts: [{ type: "text", text: "All good here." }] },
      { role: "user", parts: [{ type: "text", text: "ok" }] },
    ];

    const out = sanitizeMessageHistory(msgs);

    expect(out[1]).toBe(msgs[1]);
  });

  it("never touches the most recent message even if marked errored", () => {
    const msgs: Msg[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "partial tail" }],
        streamingState: "errored",
      },
    ];

    const out = sanitizeMessageHistory(msgs);

    // Last message is exempt by contract (it's the live turn).
    expect(out[1].parts[0].text).toBe("partial tail");
  });
});
