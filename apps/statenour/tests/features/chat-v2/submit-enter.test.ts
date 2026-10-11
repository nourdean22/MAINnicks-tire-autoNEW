/**
 * tests/features/chat-v2/submit-enter.test.ts · audit 09-F9 / 09-F10 (task B6).
 *
 * 09-F9: no Enter site checked IME composition, so the Enter that CONFIRMS a
 * Japanese/Chinese/Korean candidate sent a half-typed message.
 * 09-F10: on a phone, Enter sent the message, so a newline was impossible.
 */
import { describe, it, expect } from "vitest";
import { isSubmitEnter } from "@/features/chat-v2/lib/submit-enter";

const enter = (extra: Record<string, unknown> = {}) =>
  ({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, keyCode: 13, nativeEvent: { isComposing: false }, ...extra }) as never;

describe("isSubmitEnter", () => {
  it("plain Enter submits on a fine pointer", () => {
    expect(isSubmitEnter(enter(), { coarsePointer: false })).toBe(true);
  });

  it("Shift+Enter never submits (newline)", () => {
    expect(isSubmitEnter(enter({ shiftKey: true }), { coarsePointer: false })).toBe(false);
  });

  it("other keys never submit", () => {
    expect(isSubmitEnter(enter({ key: "a" }), { coarsePointer: false })).toBe(false);
  });

  it("IME composing never submits (nativeEvent.isComposing)", () => {
    expect(isSubmitEnter(enter({ nativeEvent: { isComposing: true } }), { coarsePointer: false })).toBe(false);
  });

  it("IME composing never submits (Safari's keyCode 229)", () => {
    expect(isSubmitEnter(enter({ keyCode: 229 }), { coarsePointer: false })).toBe(false);
  });

  it("on a coarse pointer, plain Enter is a newline", () => {
    expect(isSubmitEnter(enter(), { coarsePointer: true })).toBe(false);
  });

  it("on a coarse pointer with a hardware keyboard, Cmd/Ctrl+Enter still sends", () => {
    expect(isSubmitEnter(enter({ metaKey: true }), { coarsePointer: true })).toBe(true);
    expect(isSubmitEnter(enter({ ctrlKey: true }), { coarsePointer: true })).toBe(true);
  });

  it("defaults to a fine pointer (single-line inputs have no newline to protect)", () => {
    expect(isSubmitEnter(enter())).toBe(true);
  });
});
