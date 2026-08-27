import { describe, expect, it, vi } from "vitest";
import { NarrationController } from "./narration-controller";
import type { SpeechEngine } from "./engines";

/** Controllable fake engine — each speak() returns a promise we settle by hand. */
function fakeEngine(name: string, supported = true) {
  const spoken: string[] = [];
  const prewarmed: string[] = [];
  const pending: Array<{ text: string; resolve: () => void; reject: (e: Error) => void }> = [];
  const engine: SpeechEngine = {
    name,
    isSupported: () => supported,
    prime: vi.fn(),
    stop: vi.fn(),
    prewarm: (text: string) => {
      prewarmed.push(text);
    },
    speak(text: string) {
      spoken.push(text);
      return new Promise<void>((resolve, reject) => {
        pending.push({ text, resolve, reject });
      });
    },
  };
  return { engine, spoken, pending, prewarmed };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("NarrationController", () => {
  it("plays queued spans in order, one at a time", async () => {
    const a = fakeEngine("primary");
    const ctl = new NarrationController([a.engine]);
    ctl.enqueue("one");
    ctl.enqueue("two");
    await tick();
    expect(a.spoken).toEqual(["one"]); // second span waits for the first
    a.pending[0].resolve();
    await tick();
    expect(a.spoken).toEqual(["one", "two"]);
    a.pending[1].resolve();
    await tick();
    expect(ctl.state).toBe("idle");
  });

  it("never speaks a span twice (positive control: it does speak it once)", async () => {
    const a = fakeEngine("primary");
    const ctl = new NarrationController([a.engine]);
    ctl.enqueue("only once");
    await tick();
    a.pending[0].resolve();
    await tick();
    expect(a.spoken).toEqual(["only once"]);
  });

  it("STOP MEANS STOP: clears queue, halts engine, and a stale async result cannot restart playback", async () => {
    const a = fakeEngine("primary");
    const ctl = new NarrationController([a.engine]);
    ctl.enqueue("first");
    ctl.enqueue("second");
    ctl.enqueue("third");
    await tick();
    expect(a.spoken).toEqual(["first"]);

    ctl.stop();
    expect(a.engine.stop).toHaveBeenCalled();
    expect(ctl.state).toBe("idle");

    // The in-flight speak() settles AFTER the stop — dead generation.
    a.pending[0].resolve();
    await tick();
    expect(a.spoken).toEqual(["first"]); // second/third never spoke
    expect(ctl.state).toBe("idle");
  });

  it("a stale FAILURE after stop() cannot trigger engine fallback", async () => {
    const a = fakeEngine("primary");
    const b = fakeEngine("fallback");
    const ctl = new NarrationController([a.engine, b.engine]);
    ctl.enqueue("span");
    await tick();
    ctl.stop();
    a.pending[0].reject(new Error("network died"));
    await tick();
    expect(b.spoken).toEqual([]); // fallback never fired for a dead generation
  });

  it("falls back to the next engine when the primary fails, and records who spoke", async () => {
    const a = fakeEngine("primary");
    const b = fakeEngine("fallback");
    const engineUsed: string[] = [];
    const ctl = new NarrationController([a.engine, b.engine], { onEngineUsed: (n) => engineUsed.push(n) });
    ctl.enqueue("resilient span");
    await tick();
    a.pending[0].reject(new Error("503"));
    await tick();
    expect(b.spoken).toEqual(["resilient span"]);
    expect(ctl.activeEngine).toBe("fallback");
    // The degradation is VISIBLE: both the attempt and the fallback fired the callback.
    expect(engineUsed).toEqual(["primary", "fallback"]);
    b.pending[0].resolve();
    await tick();
    expect(ctl.state).toBe("idle");
  });

  it("skips unsupported engines entirely", async () => {
    const a = fakeEngine("dead", false);
    const b = fakeEngine("live");
    const ctl = new NarrationController([a.engine, b.engine]);
    ctl.enqueue("hello");
    await tick();
    expect(a.spoken).toEqual([]);
    expect(b.spoken).toEqual(["hello"]);
  });

  it("when every engine fails: onError fires, queue clears — no silent success", async () => {
    const a = fakeEngine("primary");
    const onError = vi.fn();
    const ctl = new NarrationController([a.engine], { onError });
    ctl.enqueue("doomed");
    ctl.enqueue("also doomed");
    await tick();
    a.pending[0].reject(new Error("engine down"));
    await tick();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(ctl.state).toBe("idle");
    expect(a.spoken).toEqual(["doomed"]); // second span was dropped, not attempted into the void
  });

  it("reports unsupported when NO engine is available (capability gate)", () => {
    const ctl = new NarrationController([fakeEngine("a", false).engine, fakeEngine("b", false).engine]);
    expect(ctl.isSupported()).toBe(false);
    // positive control
    const ctl2 = new NarrationController([fakeEngine("a", true).engine]);
    expect(ctl2.isSupported()).toBe(true);
  });

  it("spans enqueued while the last span is finishing still play (unwind race)", async () => {
    const a = fakeEngine("primary");
    const ctl = new NarrationController([a.engine]);
    ctl.enqueue("first");
    await tick();
    // enqueue during the active await, then resolve
    ctl.enqueue("second");
    a.pending[0].resolve();
    await tick();
    expect(a.spoken).toEqual(["first", "second"]);
    a.pending[1].resolve();
    await tick();
    expect(ctl.state).toBe("idle");
  });

  it("pipelines: prewarns the NEXT span while the current one plays", async () => {
    const a = fakeEngine("primary");
    const ctl = new NarrationController([a.engine]);
    ctl.enqueue("first sentence");
    ctl.enqueue("second sentence");
    ctl.enqueue("third sentence");
    await tick();
    // While "first" is speaking, "second" is already synthesizing.
    expect(a.spoken).toEqual(["first sentence"]);
    expect(a.prewarmed).toEqual(["second sentence"]);
    a.pending[0].resolve();
    await tick();
    expect(a.prewarmed).toEqual(["second sentence", "third sentence"]);
  });

  it("ignores empty/whitespace spans", async () => {
    const a = fakeEngine("primary");
    const ctl = new NarrationController([a.engine]);
    ctl.enqueue("   ");
    ctl.enqueue("");
    await tick();
    expect(a.spoken).toEqual([]);
    expect(ctl.state).toBe("idle");
  });
});
