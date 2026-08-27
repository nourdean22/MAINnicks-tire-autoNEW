import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSpeechEngine, ServerTtsEngine } from "./engines";

/**
 * Capability detection — the gate that keeps a dead control from
 * rendering. Each negative case pairs with a positive control so a
 * broken harness cannot falsely pass.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebSpeechEngine capability detection", () => {
  it("unsupported when speechSynthesis is undefined (forced)", () => {
    vi.stubGlobal("window", {} as unknown as Window);
    expect(new WebSpeechEngine().isSupported()).toBe(false);
  });

  it("unsupported when window itself is absent (SSR)", () => {
    // node test env: no window global at all
    expect(typeof window).toBe("undefined");
    expect(new WebSpeechEngine().isSupported()).toBe(false);
  });

  it("POSITIVE CONTROL: supported when speechSynthesis + utterance ctor exist", () => {
    vi.stubGlobal("window", {
      speechSynthesis: { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] },
      SpeechSynthesisUtterance: function MockUtterance() {} as unknown as typeof SpeechSynthesisUtterance,
    });
    expect(new WebSpeechEngine().isSupported()).toBe(true);
  });

  it("speak() rejects rather than hangs when unsupported", async () => {
    vi.stubGlobal("window", {} as unknown as Window);
    await expect(new WebSpeechEngine().speak("hello")).rejects.toThrow("speechSynthesis unavailable");
  });

  it("cancel-shaped utterance errors resolve (no false engine-fallback), real errors reject", async () => {
    type UtterLike = {
      text: string;
      onend: (() => void) | null;
      onerror: ((e: { error: string }) => void) | null;
      voice: unknown; rate: number; pitch: number;
    };
    const spoken: UtterLike[] = [];
    function MockUtterance(this: UtterLike, text: string) {
      this.text = text; this.onend = null; this.onerror = null;
      this.rate = 1; this.pitch = 1; this.voice = null;
    }
    vi.stubGlobal("window", {
      speechSynthesis: {
        speak: (u: UtterLike) => { spoken.push(u); },
        cancel: vi.fn(),
        getVoices: () => [],
      },
      SpeechSynthesisUtterance: MockUtterance as unknown as typeof SpeechSynthesisUtterance,
    });
    const engine = new WebSpeechEngine();

    const cancelled = engine.speak("will be cancelled");
    spoken[0].onerror?.({ error: "interrupted" });
    await expect(cancelled).resolves.toBeUndefined();

    const failed = engine.speak("will fail");
    spoken[1].onerror?.({ error: "synthesis-failed" });
    await expect(failed).rejects.toThrow("synthesis-failed");

    // positive control: normal completion resolves via onend
    const ok = engine.speak("completes");
    spoken[2].onend?.();
    await expect(ok).resolves.toBeUndefined();
  });
});

describe("ServerTtsEngine capability detection", () => {
  it("unsupported without window/fetch/Audio; supported with them (positive control)", () => {
    expect(new ServerTtsEngine().isSupported()).toBe(false); // node env: no window

    vi.stubGlobal("window", {
      fetch: vi.fn(),
      Audio: function MockAudio() {} as unknown as typeof Audio,
    });
    expect(new ServerTtsEngine().isSupported()).toBe(true);
  });

  it("speak() rejects on a non-OK route response (falls through to the fallback engine)", async () => {
    function MockAudio(this: { setAttribute: () => void; preload: string }) {
      this.setAttribute = () => {};
      this.preload = "";
    }
    vi.stubGlobal("window", {
      fetch: vi.fn(),
      Audio: MockAudio as unknown as typeof Audio,
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    const engine = new ServerTtsEngine("/api/ai/speak");
    await expect(engine.speak("hello")).rejects.toThrow("speak route 503");
  });
});

describe("ServerTtsEngine prewarm pipelining", () => {
  it("speak() reuses the in-flight prewarm fetch — one network call, not two", async () => {
    function MockAudio(this: Record<string, unknown>) {
      this.setAttribute = () => {};
      this.preload = "";
      this.play = function (this: Record<string, unknown>) {
        // resolve playback immediately via onended
        setTimeout(() => (this.onended as () => void)?.(), 0);
        return Promise.resolve();
      };
      this.pause = () => {};
    }
    vi.stubGlobal("window", { fetch: vi.fn(), Audio: MockAudio as unknown as typeof Audio });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    let resolveFetch: (r: unknown) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const engine = new ServerTtsEngine("/api/ai/speak");
    engine.prewarm("hello world");
    const speaking = engine.speak("hello world");
    expect(fetchMock).toHaveBeenCalledTimes(1); // deduped — the canary
    resolveFetch({ ok: true, blob: async () => new Blob([new Uint8Array([1])]) });
    await speaking;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stop() aborts pending prewarm fetches", () => {
    vi.stubGlobal("window", {
      fetch: vi.fn(),
      Audio: function MockAudio(this: Record<string, unknown>) {
        this.setAttribute = () => {};
        this.pause = () => {};
      } as unknown as typeof Audio,
    });
    let aborted = false;
    vi.stubGlobal("fetch", vi.fn((_url: string, opts: { signal: AbortSignal }) => {
      opts.signal.addEventListener("abort", () => { aborted = true; });
      return new Promise(() => {}); // never settles
    }));
    const engine = new ServerTtsEngine("/api/ai/speak");
    engine.prewarm("doomed span");
    expect(aborted).toBe(false); // positive control
    engine.stop();
    expect(aborted).toBe(true);
  });
});
