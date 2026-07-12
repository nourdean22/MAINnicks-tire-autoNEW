"use client";

/**
 * RealtimeVoiceOverlay · v10.0.359
 *
 * Full-screen overlay for speech-to-speech Nick. Activated from the
 * chat composer · click the phone icon to open · Nick connects to
 * OpenAI Realtime, you talk, he talks back, you can interrupt.
 *
 * Editorial layout per docs/aesthetic-principles.md (v10.0.352) ·
 * generous whitespace, type-led, single hero anchor (the live waveform).
 *
 * State machine:
 *   idle → connecting → connected → (speaking ⇄ listening) → idle
 *
 * Per /voice-agents skill principles:
 *   · Sub-500ms target (OpenAI Realtime native speech-to-speech)
 *   · Semantic VAD for natural turn-taking
 *   · Barge-in works automatically (interruption stops Nick mid-sentence)
 */

import { useEffect, useRef } from "react";
import { useRealtimeVoice } from "@/hooks/use-realtime-voice";
import { Mic, MicOff, X, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional brain context to pass to Nick · capped at 4000 chars server-side. */
  brainContext?: string;
  // v10.0.529.96 · Wave 40 · operator anchors forwarded into voice
  // session instructions so spoken pronouns resolve like text ones.
  operatorContext?: {
    contextRoute?: string;
    lastTaskId?: string;
    lastGoalId?: string;
    lastJournalEntryId?: string;
    lastDecisionId?: string;
    lastPinId?: string;
    lastReflectionId?: string;
    lastMissionId?: string;
  };
}

export function RealtimeVoiceOverlay({ open, onClose, brainContext, operatorContext }: Props) {
  const voice = useRealtimeVoice({ brainContext, operatorContext });
  const startedRef = useRef(false);

  // Auto-start when overlay opens · stop when closes
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      voice.start();
    }
    if (!open && startedRef.current) {
      startedRef.current = false;
      voice.stop();
    }
  }, [open, voice]);

  if (!open) return null;

  const status: "connecting" | "ready" | "you-speak" | "nick-speak" | "error" = voice.error
    ? "error"
    : !voice.isConnected
      ? "connecting"
      : voice.isUserSpeaking
        ? "you-speak"
        : voice.isAgentSpeaking
          ? "nick-speak"
          : "ready";

  const statusLabel = {
    connecting: "Connecting…",
    ready: "Speak when ready",
    "you-speak": "Listening",
    "nick-speak": "Nick speaking",
    error: "Error",
  }[status];

  const orbTone = {
    connecting: "from-zinc-700 to-zinc-900",
    ready: "from-zinc-600 to-zinc-900",
    "you-speak": "from-rose-500/60 to-rose-900/40",
    "nick-speak": "from-[var(--gold)]/60 to-amber-900/40",
    error: "from-red-700 to-red-950",
  }[status];

  return (
    <div
      className="fixed inset-0 z-[200] bg-[var(--bg-void)]/95 backdrop-blur-xl flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-mode-title"
    >
      {/* Hidden audio element — Nick's voice plays through this */}
      <audio
        ref={voice.audioElRef}
        autoPlay
        playsInline
        className="hidden"
        aria-label="Nick voice output"
      />

      {/* Live status announcer · screen-reader users hear status changes */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusLabel}
      </div>

      {/* Top bar */}
      <header className="flex items-center justify-between p-4 border-b border-[var(--border-default)]">
        <div>
          <p className="text-eyebrow">Voice mode</p>
          <h1 id="voice-mode-title" className="page-title text-lg">
            Talk to Nick
          </h1>
        </div>
        <button
          onClick={onClose}
          className="w-11 h-11 md:w-10 md:h-10 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all active:scale-90"
          aria-label="Close voice mode"
        >
          <X size={20} className="md:!w-[18px] md:!h-[18px]" />
        </button>
      </header>

      {/* Hero · breathing orb */}
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="relative w-48 h-48 md:w-64 md:h-64">
          {/* Outer pulse rings · only when speaking */}
          {(status === "you-speak" || status === "nick-speak") && (
            <>
              <div
                className={`absolute inset-0 rounded-full bg-gradient-to-br ${orbTone} opacity-40 animate-ping`}
                style={{ animationDuration: "1.6s" }}
              />
              <div
                className={`absolute inset-2 rounded-full bg-gradient-to-br ${orbTone} opacity-60 animate-pulse`}
                style={{ animationDuration: "2.2s" }}
              />
            </>
          )}
          {/* Core orb */}
          <div
            className={`absolute inset-4 rounded-full bg-gradient-to-br ${orbTone} flex items-center justify-center transition-all duration-500`}
          >
            {status === "connecting" ? (
              <Loader2 className="text-[var(--text-secondary)] animate-spin" size={48} />
            ) : status === "error" ? (
              <MicOff className="text-rose-300" size={48} />
            ) : (
              <Mic
                className={`transition-all ${
                  status === "you-speak"
                    ? "text-rose-200 scale-110"
                    : status === "nick-speak"
                      ? "text-[var(--gold)] scale-105"
                      : "text-[var(--text-secondary)]"
                }`}
                size={48}
              />
            )}
          </div>
        </div>

        {/* Status text · serif for the editorial moment */}
        <p
          className="text-display-serif text-3xl md:text-4xl text-[var(--text-primary)] mt-10 text-center"
          style={{ maxWidth: "20ch" }}
        >
          {statusLabel}
        </p>

        {voice.error && (
          <p className="page-copy text-rose-300/80 mt-4 text-center text-sm" style={{ maxWidth: "40ch" }}>
            {voice.error}
          </p>
        )}

        {/* Live transcript · low-key, editorial */}
        {voice.transcript && (
          <div
            className="mt-12 px-6 py-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/60 max-h-40 overflow-y-auto"
            style={{ maxWidth: "60ch" }}
          >
            <p className="text-eyebrow mb-2">Transcript</p>
            <p className="text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-line">
              {voice.transcript}
            </p>
          </div>
        )}
      </main>

      {/* Footer · model + sub-500ms label */}
      <footer className="px-4 py-3 border-t border-[var(--border-default)] flex items-center justify-between text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">
        <span>OpenAI Realtime · gpt-realtime · sub-500ms target</span>
        <span>{voice.isConnected ? "● live" : "○ idle"}</span>
      </footer>
    </div>
  );
}
