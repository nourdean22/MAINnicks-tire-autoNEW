/**
 * NarrationController — owns the speech queue: ordered playback, engine
 * fallback, and the stop contract.
 *
 * STOP MEANS STOP: stop() bumps a generation counter, clears the queue
 * and halts the active engine. Any synthesis promise that settles AFTER
 * a stop belongs to a dead generation and is discarded — stale async
 * results can never restart playback. Tested directly.
 *
 * Fallback: engines are tried in order per span. A span spoken by the
 * fallback is recorded in `activeEngine` so a degraded lane is
 * diagnosable, never silent. If every engine fails, the queue is
 * cleared and onError fires — no silent success.
 *
 * Framework-free on purpose: unit-tested with fake engines, no React.
 */

import type { SpeechEngine } from "./engines";

export type NarrationState = "idle" | "speaking";

export interface NarrationCallbacks {
  onStateChange?: (state: NarrationState) => void;
  onError?: (error: unknown) => void;
  /** Fires when a span STARTS on an engine — the fallback transition is
   *  the signal that keeps a degraded lane from being silent. */
  onEngineUsed?: (engine: string) => void;
}

export class NarrationController {
  private queue: string[] = [];
  private generation = 0;
  private pumping = false;
  /** Engine currently speaking - prewarm target for spans that arrive mid-playback. */
  private currentEngine: SpeechEngine | null = null;
  /** Name of the engine that actually spoke the most recent span. */
  activeEngine: string | null = null;
  state: NarrationState = "idle";

  constructor(
    private readonly engines: SpeechEngine[],
    private readonly callbacks: NarrationCallbacks = {},
  ) {}

  /** True when at least one engine can run in this environment. */
  isSupported(): boolean {
    return this.engines.some((e) => e.isSupported());
  }

  /** Call from inside a user gesture — unlocks audio on every engine. */
  prime(): void {
    for (const engine of this.engines) {
      if (engine.isSupported()) engine.prime();
    }
  }

  enqueue(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.queue.push(trimmed);
    // The streaming common-case: a span lands WHILE the previous one is
    // playing. Synthesize it now so playback never gaps on synthesis -
    // but only the head of the queue, so a stop() doesn't strand a
    // fan of in-flight synth calls (and their spend).
    if (this.pumping && this.queue.length === 1) {
      this.currentEngine?.prewarm?.(trimmed);
    }
    void this.pump();
  }

  stop(): void {
    this.generation++;
    this.queue.length = 0;
    for (const engine of this.engines) {
      try {
        engine.stop();
      } catch {
        /* engine already idle */
      }
    }
    this.setState("idle");
  }

  private setState(state: NarrationState): void {
    if (state === this.state) return;
    this.state = state;
    this.callbacks.onStateChange?.(state);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const gen = this.generation;
    try {
      this.setState("speaking");
      while (this.queue.length > 0 && gen === this.generation) {
        const text = this.queue.shift()!;
        let spoken = false;
        let lastError: unknown = null;
        for (const engine of this.engines) {
          if (gen !== this.generation) return; // stopped mid-span — stale
          if (!engine.isSupported()) continue;
          try {
            this.activeEngine = engine.name;
            this.currentEngine = engine;
            this.callbacks.onEngineUsed?.(engine.name);
            // Pipeline: synthesize the NEXT span while this one plays, so
            // slow server synthesis hides behind current audio instead of
            // appearing as a gap between sentences. (enqueue() handles the
            // spans that arrive mid-playback.)
            if (this.queue[0]) engine.prewarm?.(this.queue[0]);
            await engine.speak(text);
            if (gen !== this.generation) return; // settled after stop — stale
            spoken = true;
            break;
          } catch (error) {
            lastError = error;
            if (gen !== this.generation) return; // failed after stop — stale
          }
        }
        if (!spoken) {
          // Every engine failed — surface loudly and drop the rest of
          // the queue (each queued span would fail the same way).
          this.activeEngine = null;
          this.queue.length = 0;
          this.callbacks.onError?.(lastError ?? new Error("no supported speech engine"));
        }
      }
    } finally {
      this.pumping = false;
      if (gen === this.generation) {
        // enqueue() during the final await returns early (pumping was
        // true) — re-pump anything that slipped in while unwinding.
        if (this.queue.length > 0) void this.pump();
        else this.setState("idle");
      }
    }
  }
}
