"use client";

/**
 * useTts — React glue between the chat stream and the narration
 * pipeline (segmenter → sanitizer → controller → engines).
 *
 * Responsibilities kept OUT of here on purpose: what text is ready
 * (StreamingSpeechSegmenter), what should be spoken (sanitizeForSpeech),
 * queue/stop/fallback semantics (NarrationController). This hook only
 * wires them to React state, the persisted preference, and the two
 * autoplay guards:
 *
 *   · Only a message that STARTS STREAMING while narration is enabled
 *     is auto-spoken. Loading a conversation is not streaming, so
 *     history can never autoplay; the message that was already on
 *     screen when the toggle flipped is watermarked out.
 *   · iOS unlocks audio inside the enabling tap (controller.prime()).
 *     If the preference was hydrated from storage (no tap this
 *     session), a one-time window pointerdown primes instead.
 *
 * Preference persists at nour:chat:tts using the same hydration-safe
 * deferred read as use-chat-speed-ribbon (React 19 + Next 16 flag
 * init-from-localStorage in useState as a hydration mismatch).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { toast } from "sonner";
import { StreamingSpeechSegmenter } from "../lib/speech/segmenter";
import { sanitizeForSpeech } from "../lib/speech/sanitize";
import { NarrationController } from "../lib/speech/narration-controller";
import { ServerTtsEngine, WebSpeechEngine } from "../lib/speech/engines";

const STORAGE_KEY = "nour:chat:tts";

function textOf(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && "text" in part)
    .map((part) => part.text)
    .join("\n");
}

export interface TtsApi {
  /** At least one engine works here — when false, render NO tts controls. */
  supported: boolean;
  /** Auto-narration preference (persisted, default off). */
  enabled: boolean;
  toggle: () => void;
  /** True while audio is actually playing/queued. */
  narrating: boolean;
  /** Message currently being narrated or replayed (UI state). */
  speakingMessageId: string | null;
  /** Replay one completed assistant message (works with `enabled` off). */
  speakMessage: (id: string, text: string) => void;
  stop: () => void;
}

export function useTts({
  messages,
  isStreaming,
}: {
  messages: UIMessage[];
  isStreaming: boolean;
}): TtsApi {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const controllerRef = useRef<NarrationController | null>(null);
  const segmenterRef = useRef<StreamingSpeechSegmenter | null>(null);
  /** Message id the live follower is attached to. */
  const followedIdRef = useRef<string | null>(null);
  /** Last message on screen at enable time — never auto-spoken. */
  const watermarkIdRef = useRef<string | null>(null);
  const prevStreamingRef = useRef(false);
  const primedRef = useRef(false);

  const controller = useCallback((): NarrationController => {
    if (!controllerRef.current) {
      controllerRef.current = new NarrationController(
        // Server neural voice first; Web Speech is the offline/failure
        // fallback. The controller records who actually spoke.
        [new ServerTtsEngine(), new WebSpeechEngine()],
        {
          onStateChange: (state) => {
            setNarrating(state === "speaking");
            if (state === "idle") setSpeakingMessageId(null);
          },
          onError: () => {
            toast.error("Read-aloud failed — every speech engine errored", { id: "tts-error" });
          },
        },
      );
    }
    return controllerRef.current;
  }, []);

  // Mount: capability + persisted preference (deferred, hydration-safe).
  useEffect(() => {
    setSupported(controller().isSupported());
    try {
      const stored = localStorage.getItem(STORAGE_KEY) === "1";
      if (stored) setTimeout(() => setEnabledState(true), 0);
    } catch {
      /* private mode — default off is fine */
    }
  }, [controller]);

  // Hydrated-on preference means no enabling tap this session: prime on
  // the first interaction anywhere so iOS unlocks before narration.
  useEffect(() => {
    if (!enabled || primedRef.current) return;
    const prime = () => {
      primedRef.current = true;
      controller().prime();
      window.removeEventListener("pointerdown", prime);
    };
    window.addEventListener("pointerdown", prime);
    return () => window.removeEventListener("pointerdown", prime);
  }, [enabled, controller]);

  const toggle = useCallback(() => {
    setEnabledState((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* preference just won't survive reload */
      }
      if (next) {
        // Called inside the tap — this is the iOS audio unlock.
        primedRef.current = true;
        controller().prime();
        // Never auto-speak what's already on screen.
        watermarkIdRef.current = messages[messages.length - 1]?.id ?? null;
        followedIdRef.current = null;
      } else {
        controller().stop();
        followedIdRef.current = null;
        segmenterRef.current = null;
      }
      return next;
    });
  }, [controller, messages]);

  // Live follower — feed the streaming assistant message through the
  // segmenter and enqueue each sanitized span as it completes.
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (!enabled) return;

    const last = messages[messages.length - 1];

    if (isStreaming && last?.role === "assistant") {
      if (followedIdRef.current !== last.id) {
        if (last.id === watermarkIdRef.current) return; // pre-enable message
        followedIdRef.current = last.id;
        segmenterRef.current = new StreamingSpeechSegmenter();
        setSpeakingMessageId(last.id);
      }
      const spans = segmenterRef.current?.feed(textOf(last)) ?? [];
      for (const span of spans) {
        const speakable = sanitizeForSpeech(span);
        if (speakable) controller().enqueue(speakable);
      }
      return;
    }

    // Stream just finished — flush the unterminated tail.
    if (wasStreaming && !isStreaming && followedIdRef.current) {
      const followed = messages.find((m) => m.id === followedIdRef.current);
      if (followed && segmenterRef.current) {
        for (const span of segmenterRef.current.flush(textOf(followed))) {
          const speakable = sanitizeForSpeech(span);
          if (speakable) controller().enqueue(speakable);
        }
      }
      followedIdRef.current = null;
      segmenterRef.current = null;
    }
  }, [messages, isStreaming, enabled, controller]);

  const stop = useCallback(() => {
    controller().stop();
    followedIdRef.current = null;
  }, [controller]);

  const speakMessage = useCallback(
    (id: string, text: string) => {
      const ctl = controller();
      ctl.stop();
      // Replay taps are user gestures — prime here too so a replay
      // works even when auto-narration was never enabled.
      primedRef.current = true;
      ctl.prime();
      const segmenter = new StreamingSpeechSegmenter();
      for (const span of segmenter.flush(text)) {
        const speakable = sanitizeForSpeech(span);
        if (speakable) ctl.enqueue(speakable);
      }
      setSpeakingMessageId(id);
    },
    [controller],
  );

  // Leaving the chat surface entirely must not leave audio running.
  useEffect(() => {
    return () => controllerRef.current?.stop();
  }, []);

  return { supported, enabled, toggle, narrating, speakingMessageId, speakMessage, stop };
}
