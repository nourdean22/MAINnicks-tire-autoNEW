import { describe, expect, it } from "vitest";
import { reconcileStreamText } from "@/lib/services/chat/reconcile-stream-text";

describe("reconcileStreamText", () => {
  it("keeps an exact match unchanged", () => {
    expect(reconcileStreamText("Hello there", "Hello there")).toEqual({
      text: "Hello there",
      relation: "exact",
      recoveredChars: 0,
    });
  });

  it("recovers a missing leading delta", () => {
    expect(reconcileStreamText("there", "Hello there")).toEqual({
      text: "Hello there",
      relation: "accumulator-has-prefix",
      recoveredChars: 6,
    });
  });

  it("recovers a missing trailing delta", () => {
    expect(reconcileStreamText("Hello", "Hello there")).toEqual({
      text: "Hello there",
      relation: "accumulator-has-suffix",
      recoveredChars: 6,
    });
  });

  it("keeps the more complete final event when the accumulator lags", () => {
    expect(reconcileStreamText("Hello there", "Hello")).toEqual({
      text: "Hello there",
      relation: "final-has-suffix",
      recoveredChars: 0,
    });
  });

  it("does not guess across unrelated text", () => {
    expect(reconcileStreamText("A different answer", "The visible answer")).toEqual({
      text: "A different answer",
      relation: "ambiguous",
      recoveredChars: 0,
    });
  });

  it("does not use a pathological accumulator mismatch", () => {
    expect(reconcileStreamText("tail", `${"prefix ".repeat(400)}tail`).relation).toBe("ambiguous");
  });
});
