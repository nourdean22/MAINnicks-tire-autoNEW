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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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
  const {
    start,
    stop,
    isConnected,
    isUserSpeaking,
    isAgentSpeaking,
    transcript,
    error,
    audioElRef,
  } = useRealtimeVoice({ brainContext, operatorContext });
  const startedRef = useRef(false);

  // Auto-start when overlay opens · stop when closes
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      start();
    }
    if (!open && startedRef.current) {
      startedRef.current = false;
      stop();
    }
  }, [open, start, stop]);

  const status: "connecting" | "ready" | "you-speak" | "nick-speak" | "error" = error
    ? "error"
    : !isConnected
      ? "connecting"
      : isUserSpeaking
        ? "you-speak"
        : isAgentSpeaking
          ? "nick-speak"
          : "ready";

  const statusLabel = {
    connecting: "Connecting…",
    ready: "Speak when ready",
    "you-speak": "Listening",
    "nick-speak": "Nick speaking",
    error: "Error",
  }[status];

  // UI v2 (SYSTEM.md §9 status grammar): the disc carries the state as an edge hue + glyph, and the
  // ONLY motion is a `pulse-live` ring while a voice is actually working. No orb, no gradient, no ping.
  const discTone = {
    connecting: "border-edge-default text-fg-tertiary",
    ready: "border-edge-strong text-fg-secondary",
    "you-speak": "border-rose-400/60 text-rose-300",
    "nick-speak": "border-amber-400/60 text-amber-300",
    error: "border-rose-500/50 text-rose-300",
  }[status];
  const working = status === "you-speak" || status === "nick-speak";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        unstyled
        showCloseButton={false}
        overlayClassName="z-[200] bg-[var(--bg-void)]/95"
        className="fixed inset-0 z-[201] flex flex-col bg-[var(--bg-void)]/95 outline-none"
      >
      {/* Hidden audio element — Nick's voice plays through this */}
      <audio
        ref={audioElRef}
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
          <DialogTitle className="page-title text-lg">
            Talk to Nick
          </DialogTitle>
        </div>
        <button
          onClick={onClose}
          className="w-11 h-11 md:w-10 md:h-10 rounded-control flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-all active:scale-90"
          aria-label="Close voice mode"
        >
          <X size={20} className="md:!w-[18px] md:!h-[18px]" />
        </button>
      </header>

      {/* Hero · a solid state disc, not an orb (SYSTEM.md §13: NO orb) */}
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="relative flex h-40 w-40 items-center justify-center md:h-48 md:w-48">
          {working && (
            <span
              aria-hidden
              className={`pulse-live absolute inset-0 rounded-full border-2 ${
                status === "you-speak" ? "border-rose-400/40" : "border-amber-400/40"
              }`}
            />
          )}
          <div
            className={`flex h-28 w-28 items-center justify-center rounded-full border-2 bg-surface-raised transition-colors duration-[var(--motion-state)] md:h-32 md:w-32 ${discTone}`}
          >
            {status === "connecting" ? (
              <Loader2 className="animate-spin" size={40} strokeWidth={1.75} />
            ) : status === "error" ? (
              <MicOff size={40} strokeWidth={1.75} />
            ) : (
              <Mic size={40} strokeWidth={working ? 2.25 : 1.75} />
            )}
          </div>
        </div>

        {/* Status line · sentence-case Geist; the word carries the state, the hue only echoes it */}
        <p
          className="mt-8 text-center text-[17px] font-semibold text-fg md:text-[20px]"
          style={{ maxWidth: "20ch" }}
        >
          {statusLabel}
        </p>

        {error && (
          <p className="page-copy text-rose-300/80 mt-4 text-center text-sm" style={{ maxWidth: "40ch" }}>
            {error}
          </p>
        )}

        {/* Live transcript · low-key, editorial */}
        {transcript && (
          <div
            className="mt-12 px-6 py-4 rounded-surface border border-[var(--border-default)] bg-[var(--bg-raised)]/60 max-h-40 overflow-y-auto"
            style={{ maxWidth: "60ch" }}
          >
            <p className="text-eyebrow mb-2">Transcript</p>
            <p className="text-[var(--text-secondary)] text-sm leading-relaxed whitespace-pre-line">
              {transcript}
            </p>
          </div>
        )}
      </main>

      {/* Footer · model + sub-500ms label */}
      <footer className="px-4 py-3 border-t border-[var(--border-default)] flex items-center justify-between text-[11px] font-mono text-[var(--text-tertiary)]">
        <span>OpenAI Realtime · gpt-realtime · sub-500ms target</span>
        <span>{isConnected ? "● live" : "○ idle"}</span>
      </footer>
      </DialogContent>
    </Dialog>
  );
}
