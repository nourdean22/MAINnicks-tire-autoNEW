import { describe, it, expect } from "vitest";
import { withTimeout, TimeoutError } from "@/lib/utils/with-timeout";

describe("withTimeout", () => {
  it("resolves with the value when the promise beats the deadline", async () => {
    const fast = new Promise<string>((r) => setTimeout(() => r("ok"), 5));
    await expect(withTimeout(fast, 100, "fast")).resolves.toBe("ok");
  });

  it("rejects with TimeoutError when the promise exceeds the deadline", async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r("late"), 100));
    await expect(withTimeout(slow, 10, "slow")).rejects.toBeInstanceOf(TimeoutError);
  });

  it("surfaces the underlying rejection unchanged when it loses no race", async () => {
    const boom = Promise.reject(new Error("upstream failed"));
    await expect(withTimeout(boom, 100, "boom")).rejects.toThrow("upstream failed");
  });

  it("includes the label and ms in the timeout message", async () => {
    const slow = new Promise((r) => setTimeout(r, 50));
    await expect(withTimeout(slow, 5, "intent-router")).rejects.toThrow(
      /intent-router timed out after 5ms/,
    );
  });
});
