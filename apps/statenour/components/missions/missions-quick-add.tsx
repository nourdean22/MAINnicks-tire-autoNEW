"use client";

/**
 * MissionsQuickAdd · 2026-05-28 · Wave AA Phase 1A.
 *
 * Single page-top input. The operator types one of:
 *
 *   · "create mission X"  → opens mission-create flow (Phase 2)
 *   · anything else        → creates a task. Phase 1B's AI classifier
 *                            attaches it to the best-fit mission
 *                            (silent if confidence ≥ 60%; chip-prompted
 *                            otherwise).
 *
 * Phase 1A behavior: any task added here is created as unattached
 * (missionId="inbox") so the operator can immediately drag it. The AI
 * classifier wires into this same component in Phase 1B with a single
 * additional fetch in the onSubmit handler.
 */

import { useCallback, useState } from "react";
import { Loader2, Mic, Plus, Send } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MissionsQuickAddProps {
  /** Handler invoked with the trimmed input. The page owns whether the
   *  text becomes a mission, a task, or an AI-classified task with a
   *  proposed missionId. */
  onSubmit: (text: string) => void | Promise<void>;
  /** Optional voice handler · click mic to record + transcribe. */
  onVoice?: () => void | Promise<void>;
  voiceActive?: boolean;
  busy?: boolean;
}

export function MissionsQuickAdd({
  onSubmit,
  onVoice,
  voiceActive,
  busy,
}: MissionsQuickAddProps) {
  const [text, setText] = useState("");

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    try {
      await onSubmit(trimmed);
      setText("");
    } catch {
      // Errors surface via toast in parent · keep the text so operator can retry.
    }
  }, [text, busy, onSubmit]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="flex items-center gap-3"
    >
      <div className="relative flex-1">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="what&apos;s next?"
          disabled={busy}
          className={cn(
            // wave-AB.d-mobile · 15px → 16px · iOS Safari zoom-on-focus
            // floor is 16px · pre-fix every quick-add tap on iPhone PWA
            // zoomed in jarringly + reset the page layout.
            // 2026-09-16 · Visible Transformation: a ruled input line, not a box.
            "w-full min-h-[48px] border-0 border-b-2 border-edge bg-transparent px-0 py-2 text-[18px] text-fg placeholder:text-fg-tertiary transition-colors",
            "focus:border-accent focus:outline-none",
            "disabled:opacity-50",
          )}
          aria-label="mission or task input"
          autoComplete="off"
          spellCheck
        />
      </div>
      {onVoice && (
        <button
          type="button"
          onClick={() => void onVoice()}
          disabled={busy}
          aria-label={voiceActive ? "stop recording" : "voice input"}
          className={cn(
            "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-control border transition-colors duration-[var(--motion-state)]",
            voiceActive
              ? "pulse-live border-rose-500/50 bg-rose-500/10 text-rose-400"
              : "border-edge-default text-fg-tertiary hover:border-edge-strong hover:text-fg",
            "disabled:opacity-40",
          )}
        >
          <Mic size={16} strokeWidth={2} />
        </button>
      )}
      <button
        type="submit"
        disabled={!text.trim() || busy}
        aria-label="submit"
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-control border border-edge-default bg-content text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-40"
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" strokeWidth={2} />
        ) : text.trim() ? (
          <Send size={16} strokeWidth={2} />
        ) : (
          <Plus size={16} strokeWidth={2} />
        )}
      </button>
    </form>
  );
}
