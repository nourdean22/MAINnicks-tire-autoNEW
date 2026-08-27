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
}

/* ────────────────────────────── Web Speech ───────────────────────────── */

export class WebSpeechEngine implements SpeechEngine {
  readonly name = "web-speech";

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
      utter.rate = 1.05;
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
  /** Replaying a message must not re-bill synthesis — cache by span text. */
  private cache = new Map<string, Blob>();

  constructor(private readonly endpoint = "/api/ai/speak") {}

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

  async speak(text: string): Promise<void> {
    const audio = this.ensureAudio();
    let blob = this.cache.get(text);
    if (!blob) {
      this.abort = new AbortController();
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
        signal: this.abort.signal,
      });
      if (!res.ok) throw new Error(`speak route ${res.status}`);
      blob = await res.blob();
      this.cacheSet(text, blob);
    }

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
    if (!this.audio) this.audio = new window.Audio();
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
