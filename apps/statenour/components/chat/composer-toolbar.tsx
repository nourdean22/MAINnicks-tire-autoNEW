"use client";

import * as React from "react";
import { Paperclip, Mic, Square, FileAudio, Phone, Image as ImageIcon } from "lucide-react";
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
}) {
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

      {/* v10.0.413 · mode-persona chip · cycles default/battle/reflect/execute · auto-prepends prefix on send */}
      {/* v10.0.478 · hidden on mobile — chip was crushing the textarea
          to ~0px on 375px viewport. Slash-prefix (/battle, /reflect,
          /execute) still works for explicit mode override on phone. */}
      <div className="hidden sm:contents">
        <ModePersonaChip mode={personaMode} onChange={onPersonaModeChange} />
      </div>

      <button
        onClick={onOpenAudio}
        disabled={audioTranscribing}
        className={cn(
          // v10.0.478 · `hidden sm:flex` — audio attach hidden on
          // mobile to free composer width. Operator can still drag
          // an audio file into the chat (handled by the same
          // audioInputRef via OS-native file picker · or upload from
          // desktop where the button is visible).
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

      {/* v10.0.359 · speech-to-speech mode · phone icon opens
          full voice overlay, OpenAI Realtime API, sub-500ms target */}
      <button
        onClick={onOpenVoiceMode}
        // v10.0.528 · a11y A2 · mobile w-10 → w-11 (40 → 44px Apple HIG).
        className="shrink-0 w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--bg-elevated)] transition-all active:scale-90"
        title="Talk to Nick (voice mode · OpenAI Realtime)"
        aria-label="Open voice mode to talk to Nick"
      >
        <Phone size={14} />
      </button>

      <button
        onClick={onOpenCamera}
        // v10.0.478 · was `md:hidden` (mobile-only) but on mobile the
        // button row was crushing the textarea. Hidden on phones too
        // now · paperclip's accept includes image/* so the OS-native
        // file picker on mobile already lets you take a photo. The
        // tablet (sm-md range) keeps it for one-tap camera access.
        className="shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-all active:scale-90 hidden sm:flex md:hidden"
        title="Take photo"
        aria-label="Take photo"
      >
        <ImageIcon size={14} />
      </button>
    </>
  );
}
