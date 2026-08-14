/**
 * BDN-311 · media dock store.
 *
 * Two properties carry the feature:
 *   1. docking what is already playing must NOT restart it (a remount
 *      loses the position, which is the whole point of a dock);
 *   2. two identical seeks must be two distinct requests (otherwise
 *      re-clicking the same transcript timestamp silently does nothing).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetMediaDockForTest,
  useMediaDockStore,
  type DockedMedia,
} from "@/features/chat-v2/stores/media-dock-store";

const s = () => useMediaDockStore.getState();

const clip = (id: string): DockedMedia => ({
  id,
  url: `https://cdn.example.com/${id}.mp4`,
  kind: "video",
  title: `clip ${id}`,
});

beforeEach(() => {
  __resetMediaDockForTest();
});

describe("media-dock · docking", () => {
  it("docks an item and starts closed-but-present", () => {
    s().dock(clip("a"));
    expect(s().item?.id).toBe("a");
    expect(s().expanded).toBe(false);
  });

  it("re-docking the SAME item is a no-op (does not restart playback)", () => {
    s().dock(clip("a"));
    s().requestSeek(30);
    const before = s().item;
    s().dock(clip("a"));
    // Identity preserved => React keeps the same element, no remount.
    expect(s().item).toBe(before);
    expect(s().seek?.seconds).toBe(30);
  });

  it("docking a DIFFERENT item replaces it and drops a stale seek", () => {
    s().dock(clip("a"));
    s().requestSeek(30);
    s().dock(clip("b"));
    expect(s().item?.id).toBe("b");
    // A seek meant for 'a' must never land on 'b'.
    expect(s().seek).toBeNull();
  });

  it("preserves the expanded state across a swap", () => {
    s().dock(clip("a"));
    s().setExpanded(true);
    s().dock(clip("b"));
    expect(s().expanded).toBe(true);
  });
});

describe("media-dock · queue", () => {
  it("enqueue with nothing docked plays immediately", () => {
    s().enqueue(clip("a"));
    expect(s().item?.id).toBe("a");
    expect(s().queue).toHaveLength(0);
  });

  it("enqueue while playing appends without interrupting", () => {
    s().dock(clip("a"));
    s().enqueue(clip("b"));
    expect(s().item?.id).toBe("a");
    expect(s().queue.map((q) => q.id)).toEqual(["b"]);
  });

  it("does not double-queue the same item", () => {
    s().dock(clip("a"));
    s().enqueue(clip("b"));
    s().enqueue(clip("b"));
    s().enqueue(clip("a")); // already playing
    expect(s().queue.map((q) => q.id)).toEqual(["b"]);
  });

  it("playNext advances and closes cleanly when the queue drains", () => {
    s().dock(clip("a"));
    s().enqueue(clip("b"));
    s().playNext();
    expect(s().item?.id).toBe("b");
    s().playNext();
    expect(s().item).toBeNull();
    expect(s().expanded).toBe(false);
  });
});

describe("media-dock · seek tokens (load-bearing)", () => {
  it("issues a NEW token for an identical repeat seek", () => {
    // Without the token this is a no-op and re-clicking the same
    // timestamp appears broken.
    s().dock(clip("a"));
    s().requestSeek(252);
    const first = s().seek!;
    s().consumeSeek();
    s().requestSeek(252);
    const second = s().seek!;
    expect(second.seconds).toBe(first.seconds);
    expect(second.token).toBeGreaterThan(first.token);
  });

  it("consumeSeek clears exactly once and is safe to call again", () => {
    s().dock(clip("a"));
    s().requestSeek(10);
    s().consumeSeek();
    expect(s().seek).toBeNull();
    expect(() => s().consumeSeek()).not.toThrow();
  });

  it("ignores negative and non-finite timestamps", () => {
    s().dock(clip("a"));
    s().requestSeek(-5);
    s().requestSeek(Number.NaN);
    expect(s().seek).toBeNull();
  });

  it("accepts a zero-second seek (jump to start is a real intent)", () => {
    s().dock(clip("a"));
    s().requestSeek(0);
    expect(s().seek?.seconds).toBe(0);
  });
});

describe("media-dock · resume positions", () => {
  it("remembers a position per id", () => {
    s().rememberPosition("a", 42);
    s().rememberPosition("b", 7);
    expect(s().resumeAt).toEqual({ a: 42, b: 7 });
  });

  it("rejects nonsense offsets rather than storing them", () => {
    s().rememberPosition("a", -1);
    s().rememberPosition("b", Number.POSITIVE_INFINITY);
    expect(s().resumeAt).toEqual({});
  });

  it("close() clears playback but KEEPS resume positions", () => {
    // Closing the dock is "stop showing me this", not "forget where I
    // was" — reopening should land where the operator left off.
    s().dock(clip("a"));
    s().rememberPosition("a", 88);
    s().close();
    expect(s().item).toBeNull();
    expect(s().resumeAt.a).toBe(88);
  });
});
