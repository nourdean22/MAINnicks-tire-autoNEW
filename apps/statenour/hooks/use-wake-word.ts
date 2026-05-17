"use client";

import { useState, useCallback, useRef } from "react";

/**
 * useWakeWord — "Hey Nick" passive listener.
 * Uses Web Speech API continuous recognition.
 * When wake word is detected, calls onActivate callback.
 */
export function useWakeWord(onActivate: () => void) {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const recognitionRef = useRef<unknown>(null);

  const start = useCallback(() => {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor() as any;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        if (transcript.includes("hey nick") || transcript.includes("hey niq") || transcript.includes("a nick")) {
          recognition.stop();
          activeRef.current = false;
          setActive(false);
          onActivate();
          return;
        }
      }
    };

    recognition.onerror = () => {
      if (activeRef.current) {
        setTimeout(() => { try { recognition.start(); } catch {} }, 1000);
      }
    };

    recognition.onend = () => {
      if (activeRef.current) {
        setTimeout(() => { try { recognition.start(); } catch {} }, 500);
      }
    };

    recognitionRef.current = recognition;
    activeRef.current = true;
    try { recognition.start(); } catch {}
    setActive(true);
  }, [onActivate]);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (recognitionRef.current) {
      try { (recognitionRef.current as any).stop(); } catch {}
      recognitionRef.current = null;
    }
    setActive(false);
  }, []);

  return { active, start, stop };
}
