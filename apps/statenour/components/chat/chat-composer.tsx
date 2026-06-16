"use client";

/**
 * ChatComposer · Wave X.h (2026-05-25) · JSX extraction.
 *
 * Lifts the ~130 LOC composer chrome (wrapper + toolbar + textarea +
 * send button) out of `app/(mastery)/chat/page.tsx` into a dedicated
 * client component. Pure JSX move · NO state lives here · every ref,
 * setter, and hook return is passed in as a prop. The parent page
 * keeps ownership of input, refs, hooks, and handlers so the existing
 * useEffect deps and event flow stay byte-for-byte identical.
 *
 * Why a wrapper component (not just markup):
 *   · The composer chrome is the visual contract: rounded chrome ·
 *     elevated bg · focus-within gold border · safe-area-inset padding ·
 *     44px Apple-HIG-floor mobile heights. Centralizing it makes future
 *     refresh of that contract a one-file edit, not a 130-line diff
 *     against the homepage.
 *   · The page.tsx component is the homepage (2880 LOC) · every LOC out
 *     of it lowers cognitive load when the operator scans the layout.
 *
 * The X.b reconciliation estimated this extraction at ~398 LOC because
 * it conflated the composer chrome with the wider above-composer zone
 * (PromptSuggestionsBar · NickSuggestions · AttachmentPreview · etc. ·
 * all separately extracted already). The actual JSX surface that
 * belongs to "the composer" is what's here — ~130 LOC.
 *
 * Mobile-first contract preserved:
 *   · iOS Safari auto-zoom guard · text-[16px] on mobile (drops to
 *     sm:text-[13.5px] on desktop · the #1 cause of /chat layout jank).
 *   · Safe-area-inset padding so the composer respects the iPhone
 *     home indicator.
 *   · 44pt min tap targets on all buttons + textarea minimum height.
 *   · Voice waveform overlay swaps in atop the textarea during
 *     mic/continuous · textarea stays mounted so transcribed text
 *     streams in cleanly on stop.
 */

import { toast } from "sonner";
import type {
  Dispatch,
  KeyboardEventHandler,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import { ComposerToolbar } from "@/components/chat/composer-toolbar";
import { ComposerSendButton } from "@/components/chat/composer-send-button";
import { VoiceWaveformOverlay } from "@/components/chat/voice-waveform-overlay";
import type { PersonaMode } from "@/components/chat/mode-persona-chip";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { useImageAttachment } from "@/hooks/use-image-attachment";
import { useSlashCommands } from "@/hooks/use-slash-commands";
import { useMentionSuggestions } from "@/hooks/use-mention-suggestions";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  // ── Textarea state + ref ──
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  adaptivePlaceholder: string;
  // ── Stream + key handling ──
  isStreaming: boolean;
  handleKey: KeyboardEventHandler<HTMLTextAreaElement>;
  // ── Send/Stop ──
  send: () => void;
  stop: () => void;
  // ── Voice ──
  voice: ReturnType<typeof useVoiceInput>;
  onOpenVoiceMode: () => void;
  // ── Audio file transcribe ──
  audioTranscribing: boolean;
  audioInputRef: RefObject<HTMLInputElement | null>;
  onAudioChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  // ── Image attach (passes the whole hook through for clipboard paste) ──
  img: ReturnType<typeof useImageAttachment>;
  // ── Persona mode chip (lives inside toolbar) ──
  personaMode: PersonaMode;
  onPersonaModeChange: (mode: PersonaMode) => void;
  // ── Toolbar long-press timer ref ──
  longPressTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  // ── Slash + mention dropdowns get input-change events ──
  slash: ReturnType<typeof useSlashCommands>;
  mentions: ReturnType<typeof useMentionSuggestions>;
  // ── Memory Inspector ──
  memoryInspectorOpen?: boolean;
  onToggleMemoryInspector?: () => void;
}

export function ChatComposer({
  input,
  setInput,
  inputRef,
  adaptivePlaceholder,
  isStreaming,
  handleKey,
  send,
  stop,
  voice,
  onOpenVoiceMode,
  audioTranscribing,
  audioInputRef,
  onAudioChange,
  img,
  personaMode,
  onPersonaModeChange,
  longPressTimerRef,
  slash,
  mentions,
  memoryInspectorOpen,
  onToggleMemoryInspector,
}: ChatComposerProps) {
  return (
    // Input row — Apr 27 · COMPOSER chrome.
    // Wraps the whole composer (mic / attach / textarea / mode /
    // send) in a single rounded container with elevated bg, so
    // the buttons read as one unit. Removes the loose-floating
    // feel and gives the composer real "weight" on the page.
    // Mobile keeps generous padding + safe-area inset; desktop
    // tightens up for density.
    <div
      className="p-2 sm:p-2"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-end gap-1.5 sm:gap-1 px-2 py-1.5 sm:py-1 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]/40 focus-within:border-[var(--gold)]/40 transition-colors">
        {/* v10.0.529.106 · Wave 83 · ~130 LOC of mic / paperclip /
            persona-chip / audio / phone / camera button JSX +
            hidden file inputs lifted into ComposerToolbar. Voice
            and image hooks stay on the parent · the toolbar
            receives intent callbacks. */}
        <ComposerToolbar
          voice={voice}
          isStreaming={isStreaming}
          audioTranscribing={audioTranscribing}
          personaMode={personaMode}
          onPersonaModeChange={onPersonaModeChange}
          longPressTimerRef={longPressTimerRef}
          onMicClick={() => {
            if (voice.continuous) {
              voice.stopContinuous();
              return;
            }
            if (voice.isRecording) {
              voice.stopRecording();
              return;
            }
            voice.startRecording();
          }}
          onContinuousStart={voice.startContinuous}
          onContinuousStop={voice.stopContinuous}
          fileInputRef={img.fileInputRef}
          cameraInputRef={img.cameraInputRef}
          audioInputRef={audioInputRef}
          onFileChange={img.handleFileChange}
          onAudioChange={onAudioChange}
          onOpenGallery={img.openGallery}
          onOpenCamera={img.openCamera}
          onOpenAudio={() => audioInputRef.current?.click()}
          onOpenVoiceMode={onOpenVoiceMode}
          memoryInspectorOpen={memoryInspectorOpen}
          onToggleMemoryInspector={onToggleMemoryInspector}
        />

        {/* Textarea (with voice waveform overlay during recording) */}
        <div className="flex-1 relative">
          {/* Apr 27 · MOBILE-FLUIDITY — voice waveform.
              When the mic is active, hide the textarea visually and
              show 5 bars that bounce to the live audioLevel. Gives
              Nour real "I see you hearing me" feedback. The textarea
              stays mounted so transcribed text streams in cleanly
              when recording stops. */}
          {(voice.isRecording || voice.continuous) && (
            <VoiceWaveformOverlay
              audioLevel={voice.audioLevel}
              mode={voice.continuous ? "continuous" : "recording"}
            />
          )}
          <textarea
            ref={inputRef}
            /* v10.0.526 · a11y A4 fix · the rotating adaptive
               placeholder is not a stable accessible name. Screen
               readers need a deterministic label. */
            aria-label="Message Nick"
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              setInput(val);
              slash.onInputChange(val);
              mentions.onInputChange(val, e.target.selectionStart ?? val.length);
            }}
            onPaste={(e) => {
              // v10.0.515 · #2 Multimodal · paste-image support.
              // If clipboard has an image, attach it and stop the
              // text-paste path (otherwise the textarea swallows
              // a blank "image" string). Returns true on hit.
              const attached = img.attachFromPaste(e);
              if (attached) {
                e.preventDefault();
                toast.success("Image attached from clipboard", { duration: 1500 });
              }
            }}
            onKeyDown={handleKey}
            placeholder={adaptivePlaceholder}
            rows={1}
            /* Apr 27 · MOBILE-FLUIDITY:
               · text-[16px] on mobile prevents iOS Safari from
                 auto-zooming on focus (the #1 cause of layout
                 jank on /chat). sm:text-[13.5px] keeps the
                 compact desktop look.
               · min-h bumped to 44px on mobile so the textarea
                 reads as a real input not a strip.
               · placeholder shows the tap-to-fix idle suggestion;
                 shrinks slightly on mobile so it fits one line. */
            className={cn(
              // Apr 27 · COMPOSER — textarea now sits inside the
              // shared composer chrome, so drop its own border + bg.
              // Transparent so the parent's elevated bg shows through;
              // the focus ring is on the parent's focus-within.
              //
              // v7.4 · Apr 29 · Mobile max-h cut 160 → 96px so the
              // composer can't eat the bottom half of the viewport
              // when a long placeholder or draft wraps. Desktop
              // unchanged.
              // v10.0.528 · a11y A2 fix · min-h was 40 / 32 (mobile /
              // desktop). Bumped mobile to 44 to match the 44pt Apple
              // HIG target the composer buttons now hit · bumped
              // desktop to 36 so the textarea visually anchors to the
              // taller Send chip (sm:h-9 = 36).
              "w-full text-[16px] sm:text-[13.5px] leading-[1.5] resize-none px-2 py-2 sm:py-1.5 min-h-[44px] sm:min-h-[36px] max-h-[96px] sm:max-h-[160px]",
              "bg-transparent border-0 text-[var(--text-primary)]",
              "placeholder:text-[var(--text-tertiary)] outline-none",
            )}
            /* v11.1 Tier-1 · input stays live during stream. Nour can
               type the NEXT turn while Nick finishes the current one.
               Send fires only when Enter is pressed AND !isStreaming
               (handleKey already gates on this). */
          />
        </div>

        {/* Mode pill — Apr 27 · COMPOSER-WEIGHT — fully hidden in
            the composer row (was already hidden on mobile, now
            hidden on desktop too). The STANDARD chip was tertiary
            info eating prime composer real estate. Mode detection
            runs server-side regardless; manual override lives in
            the ⋯ menu in the header when Nour wants it. */}

        {/* v11.1 Tier-1 · Send / Stop — kinetic button that morphs
            between send arrow and stop square.
            v10.0.529.106 · Wave 83 · ~50 LOC of inline button JSX
            lifted into ComposerSendButton. */}
        <ComposerSendButton
          isStreaming={isStreaming}
          empty={!input.trim()}
          onSend={send}
          onStop={stop}
        />
      </div>
    </div>
  );
}
