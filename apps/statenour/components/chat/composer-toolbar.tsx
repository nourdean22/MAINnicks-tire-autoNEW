"use client";

import * as React from "react";
import { Paperclip, Mic, Square, FileAudio, Phone, Image as ImageIcon, Plus, X, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModePersonaChip, type PersonaMode } from "@/components/chat/mode-persona-chip";

/**
 * ComposerToolbar — the cluster of mic / attach / mode-persona /
 * audio / phone / camera buttons that sits to the LEFT of the
 * composer textarea.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~130 LOC
 * of inline button JSX. Hooks (useVoiceInput, useImageAttachment)
 * stay on the parent; this component renders the chrome and dispatches
 * intents via props. Visual contract identical · same a11y labels,
 * same mobile/desktop sizing, same `hidden sm:flex` rules.
 *
 * The hidden file inputs (gallery, camera, audio) stay here so they
 * sit next to the buttons that trigger them via .click() · the
 * parent passes the refs + change handlers down so the dispatched
 * file events surface back where the state lives.
 */
type VoiceState = {
  isRecording: boolean;
  continuous: boolean;
  transcribing: boolean;
};

export function ComposerToolbar({
  voice,
  isStreaming,
  audioTranscribing,
  personaMode,
  onPersonaModeChange,
  longPressTimerRef,
  // Voice mic handlers
  onMicClick,
  onContinuousStart,
  onContinuousStop,
  // File / camera
  fileInputRef,
  cameraInputRef,
  audioInputRef,
  onFileChange,
  onAudioChange,
  onOpenGallery,
  onOpenCamera,
  onOpenAudio,
  onOpenVoiceMode,
  memoryInspectorOpen,
  onToggleMemoryInspector,
}: {
  voice: VoiceState;
  isStreaming: boolean;
  audioTranscribing: boolean;
  personaMode: PersonaMode;
  onPersonaModeChange: (next: PersonaMode) => void;
  longPressTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  onMicClick: () => void;
  onContinuousStart: () => void;
  onContinuousStop: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  audioInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAudioChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenGallery: () => void;
  onOpenCamera: () => void;
  onOpenAudio: () => void;
  onOpenVoiceMode: () => void;
  memoryInspectorOpen?: boolean;
  onToggleMemoryInspector?: () => void;
}) {
  // v10.0.529.96 · Wave 40 · overflow consolidation. Operator feedback:
  // "way too many buttons down there. Fix that shit." Pre-Wave-40 had
  // 5 visible buttons on desktop (Mic · Paperclip · Persona · Audio ·
  // Phone) + Camera on tablet · all crowding the textarea. Wave-40 keeps
  // Mic + Paperclip as primary (the 90%-case for input) and tucks
  // Persona/Audio/Phone/Camera behind a + overflow. Slash commands
  // (/battle /reflect /execute) still work for explicit persona override
  // without touching the chip.
  const [overflowOpen, setOverflowOpen] = React.useState(false);
  return (
    <>
      {/* Mic — tap to toggle, long-press to record + release to send */}
      <button
        onClick={onMicClick}
        onTouchStart={() => {
          longPressTimerRef.current = setTimeout(() => {
            if (!voice.isRecording && !voice.continuous && !voice.transcribing) {
              onContinuousStart();
            }
          }, 400);
        }}
        onTouchEnd={() => {
          if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
          if (voice.continuous) onContinuousStop();
        }}
        disabled={voice.transcribing || isStreaming}
        className={cn(
          // v10.0.528 · a11y A2 fix · was w-10 h-10 (40px) on mobile —
          // Apple HIG minimum is 44pt and operator's primary device
          // is iPhone Safari · 40px sits in tap-misfire zone. Bumped
          // to w-11 h-11 (44px) on mobile · desktop stays compact at
          // sm:w-8 sm:h-8 (32px) since fine-pointer precision isn't
          // the constraint there.
          "shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all",
          "active:scale-90 disabled:active:scale-100",
          voice.continuous
            ? "bg-green-500/15 text-green-400 border border-green-500/30 animate-pulse"
            : voice.isRecording
            ? "bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse"
            : voice.transcribing
              ? "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
        )}
        title={voice.continuous ? "Release to send" : voice.isRecording ? "Tap to stop" : voice.transcribing ? "Transcribing..." : "Tap or hold to talk"}
        // v10.0.529.18 a11y · dynamic aria-label that matches the
        // current state · pre-fix only `title` was set and iOS
        // VoiceOver does not announce title attributes unless the
        // element is focused. This is the operator's primary
        // input control · WCAG AA criticality.
        aria-label={
          voice.continuous
            ? "Stop continuous voice recording"
            : voice.isRecording
            ? "Stop voice recording"
            : voice.transcribing
            ? "Transcribing audio"
            : "Tap to record voice · hold to record continuously"
        }
        aria-pressed={voice.isRecording || voice.continuous}
      >
        {voice.isRecording || voice.continuous ? (
          <Square size={12} />
        ) : voice.transcribing ? (
          <div className="w-3 h-3 border-[1.5px] border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
        ) : (
          <Mic size={14} />
        )}
      </button>

      {/* Hidden file inputs — gallery + camera + audio (v10.0.349) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,text/plain,text/markdown,application/json,.md,.txt,.csv"
        className="hidden"
        onChange={onFileChange}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileChange}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onAudioChange}
      />

      <button
        onClick={onOpenGallery}
        // v10.0.528 · a11y A2 · mobile w-10 → w-11 (40 → 44px Apple HIG).
        className="shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-all active:scale-90"
        title="Attach file (image, PDF, text, CSV, markdown, JSON)"
        aria-label="Attach file"
      >
        <Paperclip size={14} />
      </button>

      {/* v10.0.529.96 · Wave 40 · overflow toggle.
          Tap to reveal persona/audio/voice/camera · tap again to collapse.
          Default closed · the 90%-case operator path is mic+paperclip+type. */}
      <button
        type="button"
        onClick={() => setOverflowOpen((v) => !v)}
        className={cn(
          "shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all active:scale-90",
          overflowOpen
            ? "bg-[var(--bg-elevated)] text-[var(--gold)]"
            : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
        )}
        title={overflowOpen ? "Collapse extras" : "More · persona · voice · audio"}
        aria-label={overflowOpen ? "Collapse extras" : "Show more composer actions"}
        aria-expanded={overflowOpen}
      >
        {overflowOpen ? <X size={14} /> : <Plus size={14} />}
      </button>

      {/* Overflow extras · revealed only when overflowOpen. Slash commands
          (/battle /reflect /execute) keep working without touching the
          persona chip · most days the operator never needs to open this. */}
      {overflowOpen && (
        <>
          <div className="hidden sm:contents">
            <ModePersonaChip mode={personaMode} onChange={onPersonaModeChange} />
          </div>

          <button
            onClick={onOpenVoiceMode}
            className="shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--bg-elevated)] transition-all active:scale-90"
            title="Talk to Nick (voice mode · OpenAI Realtime)"
            aria-label="Open voice mode to talk to Nick"
          >
            <Phone size={14} />
          </button>

          {onToggleMemoryInspector && (
            <button
              onClick={onToggleMemoryInspector}
              className={cn(
                "shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all active:scale-90",
                memoryInspectorOpen ? "text-[var(--gold)] bg-[var(--bg-elevated)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
              )}
              title="Memory Inspector"
              aria-label="Toggle Memory Inspector"
            >
              <Brain size={14} />
            </button>
          )}

          <button
            onClick={onOpenAudio}
            disabled={audioTranscribing}
            className={cn(
              "hidden sm:flex shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-lg items-center justify-center transition-all active:scale-90",
              audioTranscribing
                ? "bg-[var(--bg-elevated)] text-[var(--text-tertiary)] cursor-wait"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
            )}
            title="Drop audio · transcribe to text (mp3/wav/m4a/webm/ogg, ≤50MB)"
            aria-label={audioTranscribing ? "Transcribing audio" : "Attach audio file for transcription"}
          >
            {audioTranscribing ? (
              <div className="w-3 h-3 border-[1.5px] border-[var(--text-tertiary)] border-t-transparent rounded-full animate-spin" />
            ) : (
              <FileAudio size={14} />
            )}
          </button>

          <button
            onClick={onOpenCamera}
            className="shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-all active:scale-90 hidden sm:flex md:hidden"
            title="Take photo"
            aria-label="Take photo"
          >
            <ImageIcon size={14} />
          </button>
        </>
      )}
    </>
  );
}
