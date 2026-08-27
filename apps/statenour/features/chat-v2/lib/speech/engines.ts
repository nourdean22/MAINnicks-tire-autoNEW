/**
 * SpeechEngine — the one narrow seam between the narration pipeline and
 * however audio actually gets made. Everything above this interface
 * (segmenter, sanitizer, controller, React glue, message call sites) is
 * engine-agnostic by construction, so swapping or adding engines
 * (server-neural today, Web Speech fallback, a local Kokoro lane later)
 * never touches the chat UI.
 *
 * Engine order and fallback live in NarrationController, not here.
 */

export interface SpeechEngine {
  readonly name: string;
  /** Cheap, synchronous, safe to call during render (feature detection). */
  isSupported(): boolean;
  /**
   * Speak one sanitized span. Resolves when PLAYBACK ends; rejects on
   * synthesis/playback failure. Must settle promptly after stop() —
   * a cancelled span resolves (never hangs, never rejects as failure).
   */
  speak(text: string): Promise<void>;
  /** Halt current audio and any in-flight synthesis immediately. */
  stop(): void;
  /** Call from inside a user gesture — unlocks audio on iOS. */
  prime(): void;
  /** Playback speed multiplier (1 = natural). Applies from the next span. */
  setRate?(rate: number): void;
  /** Fire-and-forget: begin synthesizing a span so a later speak() of the
   *  same text starts instantly. Measured need: the edge lane costs
   *  2.7-5.1s per sentence from Railway (fresh WS + DRM handshake per
   *  call) - without prewarm every inter-sentence gap pays it. */
  prewarm?(text: string): void;
}

/* ────────────────────────────── Web Speech ───────────────────────────── */

export class WebSpeechEngine implements SpeechEngine {
  readonly name = "web-speech";
  private rate = 1;

  setRate(rate: number): void {
    this.rate = rate;
  }

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof window.SpeechSynthesisUtterance === "function"
    );
  }

  prime(): void {
    if (!this.isSupported()) return;
    try {
      // A zero-length utterance inside the enabling tap satisfies
      // Safari's user-activation requirement for later queued speech.
      window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(""));
    } catch {
      /* priming is best-effort */
    }
  }

  speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) {
        reject(new Error("speechSynthesis unavailable"));
        return;
      }
      const utter = new window.SpeechSynthesisUtterance(text);
      // 1.05 baseline reads natural; the multiplier is the operator's speed chip.
      utter.rate = Math.min(2, 1.05 * this.rate);
      utter.pitch = 0.95;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.name.includes("Google") && v.lang.startsWith("en")) ||
        voices.find((v) => v.lang.startsWith("en-US"));
      if (preferred) utter.voice = preferred;
      utter.onend = () => resolve();
      utter.onerror = (e) => {
        // cancel() surfaces as an error event — that's a clean stop,
        // not a failure (a rejection here would trigger engine fallback
        // and speak the span AGAIN on the other engine).
        if (e.error === "canceled" || e.error === "interrupted") resolve();
        else reject(new Error(`speechSynthesis: ${e.error}`));
      };
      window.speechSynthesis.speak(utter);
    });
  }

  stop(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* already stopped */
    }
  }
}

/* ─────────────────────────── Server neural TTS ───────────────────────── */

/** 0.05s of silence — playing this inside the enabling tap unlocks the
 *  shared <audio> element for every later programmatic play() on iOS. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

const BLOB_CACHE_MAX = 24;

export class ServerTtsEngine implements SpeechEngine {
  readonly name = "server-neural";
  private audio: HTMLAudioElement | null = null;
  private abort: AbortController | null = null;
  private rate = 1;
  /** Replaying a message must not re-bill synthesis — cache by span text. */
  private cache = new Map<string, Blob>();
  /** In-flight synthesis, deduped by span text - speak() awaits the same
   *  promise prewarm() started instead of fetching twice. */
  private pending = new Map<string, { promise: Promise<Blob>; abort: AbortController }>();

  constructor(private readonly endpoint = "/api/ai/speak") {}

  setRate(rate: number): void {
    this.rate = rate;
    // Applies mid-span too — playbackRate is live on the element.
    if (this.audio) this.audio.playbackRate = rate;
  }

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.fetch === "function" &&
      typeof window.Audio === "function"
    );
  }

  prime(): void {
    if (!this.isSupported()) return;
    try {
      const audio = this.ensureAudio();
      audio.src = SILENT_WAV;
      void audio.play().catch(() => {});
    } catch {
      /* priming is best-effort */
    }
  }

  prewarm(text: string): void {
    if (this.cache.has(text) || this.pending.has(text)) return;
    void this.fetchBlob(text).catch(() => {
      /* a failed prewarm is not an event - speak() will retry and
         surface the failure through the normal fallback path */
    });
  }

  private fetchBlob(text: string): Promise<Blob> {
    const existing = this.pending.get(text);
    if (existing) return existing.promise;
    const abort = new AbortController();
    const promise = (async () => {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`speak route ${res.status}`);
      const blob = await res.blob();
      this.cacheSet(text, blob);
      return blob;
    })().finally(() => {
      this.pending.delete(text);
    });
    this.pending.set(text, { promise, abort });
    return promise;
  }

  async speak(text: string): Promise<void> {
    const audio = this.ensureAudio();
    const blob = this.cache.get(text) ?? (await this.fetchBlob(text));

    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        // stop() pauses — a pause with time remaining is a clean stop,
        // resolved (not rejected) so the controller's generation guard
        // decides what happens next instead of engine fallback firing.
        audio.onpause = () => resolve();
        audio.onerror = () => reject(new Error("audio playback failed"));
        audio.src = url;
        audio.playbackRate = this.rate;
        audio.play().catch((err: unknown) => reject(err instanceof Error ? err : new Error("audio.play failed")));
      });
    } finally {
      audio.onended = null;
      audio.onpause = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
    }
  }

  stop(): void {
    try {
      this.abort?.abort();
    } catch {
      /* no fetch in flight */
    }
    for (const entry of this.pending.values()) {
      try {
        entry.abort.abort();
      } catch {
        /* already settled */
      }
    }
    this.pending.clear();
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch {
        /* already stopped */
      }
    }
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new window.Audio();
      // iOS PWA: without playsinline an <audio> can refuse programmatic
      // play outside a gesture even after priming.
      this.audio.setAttribute("playsinline", "");
      this.audio.preload = "auto";
    }
    return this.audio;
  }

  private cacheSet(key: string, blob: Blob): void {
    if (this.cache.size >= BLOB_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, blob);
  }
}
