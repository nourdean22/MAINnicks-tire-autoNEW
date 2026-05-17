"use client";

/**
 * useAmbientMode — "phone on the counter" hands-free operation.
 *
 * Composes wake-word detection + voice input + TTS replies into a
 * single toggle. When enabled:
 *   1. Wake-word recognition is started ("Hey Nick")
 *   2. On wake, continuous voice-input starts (sends on silence)
 *   3. Nick's response is auto-spoken via TTS
 *   4. While Nick is speaking, wake-word is paused (audio-ducking)
 *      so the mic doesn't hear Nick and restart the loop
 *
 * Persists the enabled state in localStorage so the mode sticks
 * across reloads.
 *
 * Integrates with existing hooks without changing their APIs:
 *   · useWakeWord  — exposed { active, start, stop }
 *   · useVoiceInput — consumer passes in its own reference
 *   · useTextToSpeech — consumer passes { enabled, toggle, speaking }
 *
 * Returns:
 *   { ambient: boolean, toggle: () => void, pauseMic: boolean }
 * where `pauseMic` is true whenever Nick is speaking, so callers can
 * visually indicate the ducked state (a faint dim on the mic button,
 * for example).
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "nour:ambient-mode";

interface WakeWordAPI {
  active: boolean;
  start: () => void;
  stop: () => void;
}

interface TtsAPI {
  enabled: boolean;
  toggle: () => void;
  speaking: boolean;
}

interface UseAmbientModeOptions {
  wakeWord: WakeWordAPI;
  tts: TtsAPI;
}

export function useAmbientMode({ wakeWord, tts }: UseAmbientModeOptions) {
  const [ambient, setAmbient] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setAmbient((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // swallow — localStorage blocked is fine
      }
      return next;
    });
  }, []);

  // Coordinate wake-word + TTS based on ambient flag.
  //   · ambient flips on  → turn TTS on if off · start wake-word
  //   · ambient flips off → stop wake-word (leave TTS as user set)
  useEffect(() => {
    if (ambient) {
      if (!tts.enabled) tts.toggle();
      if (!wakeWord.active) wakeWord.start();
    } else {
      if (wakeWord.active) wakeWord.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambient]);

  // Audio-ducking: pause wake-word while Nick is speaking, resume
  // when TTS ends. Without this, Nick's own TTS can trigger the
  // wake phrase again (known failure mode — "Hey Nick, hey Nick, …").
  useEffect(() => {
    if (!ambient) return undefined;
    if (tts.speaking && wakeWord.active) {
      wakeWord.stop();
      return undefined;
    } else if (!tts.speaking && !wakeWord.active && ambient) {
      // Small delay so the tail of TTS doesn't trigger wake
      const id = window.setTimeout(() => {
        if (ambient) wakeWord.start();
      }, 350);
      return () => window.clearTimeout(id);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.speaking, ambient]);

  return { ambient, toggle, pauseMic: tts.speaking };
}
