/**
 * Text-to-speech for Nick's responses.
 *
 * Uses the browser's Web Speech API. Handles:
 * - Stripping markdown before speaking
 * - Picking a good English voice (prefers Google voices)
 * - Preventing re-speaking the same message
 * - Canceling in-flight speech when disabled
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AssistantMessagePart {
  type: string;
  text?: string;
}

interface AssistantMessage {
  id: string;
  role: string;
  parts?: AssistantMessagePart[];
}

interface UseTextToSpeechOptions {
  /** Current message list from useChat */
  messages: AssistantMessage[];
  /** Whether the assistant is currently streaming — we wait for completion */
  isStreaming: boolean;
}

const MAX_SPOKEN_LEN = 500;

export function useTextToSpeech({ messages, isStreaming }: UseTextToSpeechOptions) {
  const [enabled, setEnabled] = useState(false);
  // v11.1 D2 · `speaking` lets the ambient-mode coordinator pause
  // wake-word recognition while Nick is talking, so the mic doesn't
  // pick up Nick's own voice as a new prompt.
  const [speaking, setSpeaking] = useState(false);
  const lastSpokenRef = useRef<string | null>(null);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const clean = text
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/[#*_`]/g, "")
      .replace(/\n{2,}/g, ". ")
      .slice(0, MAX_SPOKEN_LEN);
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.05;
    utter.pitch = 0.95;
    utter.volume = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.name.includes("Google") && v.lang.startsWith("en")) ||
      voices.find((v) => v.lang.startsWith("en-US"));
    if (preferred) utter.voice = preferred;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      if (!next && typeof window !== "undefined") {
        window.speechSynthesis?.cancel();
      }
      return next;
    });
  }, []);

  // Auto-speak last assistant message when TTS is on and streaming finishes
  useEffect(() => {
    if (!enabled || isStreaming) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant" && lastMsg.id !== lastSpokenRef.current) {
      const text =
        lastMsg.parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
          .map((p) => p.text)
          .join(" ") || "";
      if (text.length > 10) {
        lastSpokenRef.current = lastMsg.id;
        speak(text);
      }
    }
  }, [messages, isStreaming, enabled, speak]);

  return { enabled, toggle, speak, speaking };
}
