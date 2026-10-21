/**
 * The deleted /pins page did two things the Brain Memory pinned panel did not (wave 2V review, 2026-10-19):
 *  - after a pin create it flushed the prompt cache, so the next chat turn sees the new pin instead of
 *    waiting out the cache TTL (a flush failure must never fail the pin);
 *  - a /brain?tab=memory#pin-<id> deep link (chat "View pin" receipts) scrolled to the pin. The pin list renders
 *    after an async read, so the scroll has to wait for the row to exist.
 */
import { describe, expect, it, vi } from "vitest";
import { createPinThenFlush, pinHashTarget } from "@/components/brain/pinned-context-helpers";

describe("createPinThenFlush", () => {
  it("creates the pin, then flushes the prompt cache with a reason", async () => {
    const order: string[] = [];
    const create = vi.fn(async () => { order.push("create"); return { id: "p1" }; });
    const flush = vi.fn(() => { order.push("flush"); });
    const out = await createPinThenFlush(create, flush, { content: "x", source: "pin:manual" });
    expect(out).toEqual({ id: "p1" });
    expect(order).toEqual(["create", "flush"]);
    expect(flush).toHaveBeenCalledWith({ reason: "pin write (manual)" });
  });

  it("a failed create does NOT flush, and the error reaches the caller", async () => {
    const create = vi.fn(async () => { throw new Error("db down"); });
    const flush = vi.fn();
    await expect(createPinThenFlush(create, flush, { content: "x" })).rejects.toThrow("db down");
    expect(flush).not.toHaveBeenCalled();
  });

  it("a throwing flush never fails the pin", async () => {
    const create = vi.fn(async () => ({ id: "p1" }));
    const flush = vi.fn(() => { throw new Error("cache down"); });
    await expect(createPinThenFlush(create, flush, { content: "x" })).resolves.toEqual({ id: "p1" });
  });
});

describe("pinHashTarget", () => {
  it("returns the element id for #pin-<id> and null for anything else", () => {
    expect(pinHashTarget("#pin-abc123")).toBe("pin-abc123");
    expect(pinHashTarget("#pinned-context")).toBeNull();
    expect(pinHashTarget("#pin-")).toBeNull();
    expect(pinHashTarget("")).toBeNull();
    expect(pinHashTarget("#contradictions")).toBeNull();
  });
});
