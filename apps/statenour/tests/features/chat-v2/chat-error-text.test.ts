/**
 * tests/features/chat-v2/chat-error-text.test.ts - audit 04-X13 (a), task R3-05.
 *
 * A pre-stream failure reaches useChat as the raw response body, so the error
 * card printed '{"error":"Chat stream failed"}'. A mid-stream failure arrives
 * as the server's authored category sentence (clientSafeStreamErrorText) and
 * must still read through: that was the 2026-07-29 fix.
 */
import { describe, it, expect } from "vitest";
import { chatErrorText } from "@/features/chat-v2/lib/chat-error-text";

describe("chatErrorText", () => {
  it("unwraps a JSON error body into a sentence with no braces", () => {
    const text = chatErrorText('{"error":"Chat stream failed"}');
    expect(text).toBe("Chat stream failed.");
    expect(text).not.toMatch(/[{}"]/);
  });

  it("keeps a body sentence that already ends in punctuation as is", () => {
    expect(chatErrorText('{"error":"Daily AI budget reached. Raise the cap."}')).toBe(
      "Daily AI budget reached. Raise the cap.",
    );
  });

  // R3-15 (review finding 10): the power-panel block (lib/ai/chat/gate.ts)
  // puts the actionable part in `reason`; the raw JSON used to show it.
  it("keeps the server's reason after the error sentence", () => {
    expect(chatErrorText('{"error":"Nick paused by power panel","reason":"strict mode on, discretionary AI calls paused"}')).toBe(
      "Nick paused by power panel. strict mode on, discretionary AI calls paused.",
    );
  });

  it("CONTROL: a non-string reason is ignored", () => {
    expect(chatErrorText('{"error":"Chat stream failed","reason":null}')).toBe("Chat stream failed.");
  });

  it("passes an authored plain-text category through (mid-stream errors)", () => {
    const authored = "This conversation outgrew the model's context window. Start a new chat.";
    expect(chatErrorText(authored)).toBe(authored);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["JSON without an error string", '{"code":500}'],
    ["broken JSON", '{"error":'],
    ["an HTML error page", "<html><body>502 Bad Gateway</body></html>"],
  ])("falls back to 'Stream failed.' for %s", (_name, input) => {
    expect(chatErrorText(input)).toBe("Stream failed.");
  });
});
