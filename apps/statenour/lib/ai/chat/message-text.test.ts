import { describe, it, expect } from "vitest";
import { messageContentToText } from "./message-text";

describe("messageContentToText", () => {
  it("passes a plain string through unchanged", () => {
    expect(messageContentToText("hello #tag #two")).toBe("hello #tag #two");
  });

  it("returns '' for undefined — the exact crash case (parts-only content)", () => {
    expect(messageContentToText(undefined)).toBe("");
    expect(messageContentToText(null)).toBe("");
  });

  it("joins array parts' text with newlines", () => {
    expect(
      messageContentToText([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("tolerates array parts without a text field", () => {
    expect(messageContentToText([{ type: "tool-call" }, { text: "x" }])).toBe("\nx");
  });

  it("returns '' for numbers / objects", () => {
    expect(messageContentToText(42)).toBe("");
    expect(messageContentToText({})).toBe("");
  });

  it("the result is always .match-safe (regression for the .match TypeError)", () => {
    // The bug was `undefined.match(...)`. Result must never throw.
    expect(() => messageContentToText(undefined).match(/#\w+/g)).not.toThrow();
    expect(messageContentToText(undefined).match(/#\w+/g)).toBeNull();
  });
});
