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
      className="flex gap-2 items-center"
    >
      <div className="relative flex-1">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="what&apos;s next?"
          disabled={busy}
          className={cn(
            "w-full min-h-[44px] rounded-md border bg-[var(--bg-raised)]/[0.06] px-3 py-1.5 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/70 transition-colors",
            "border-[var(--border-default)] focus:border-[var(--gold)]/40 focus:outline-none focus:shadow-[0_0_18px_rgba(253,185,19,0.12)]",
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
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition-colors",
            voiceActive
              ? "border-rose-500/50 bg-rose-500/10 text-rose-400 animate-pulse"
              : "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.06] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40",
            "disabled:opacity-40",
          )}
        >
          <Mic size={14} strokeWidth={1.75} />
        </button>
      )}
      <button
        type="submit"
        disabled={!text.trim() || busy}
        aria-label="submit"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15 transition-colors disabled:opacity-40"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" strokeWidth={1.75} />
        ) : text.trim() ? (
          <Send size={14} strokeWidth={1.75} />
        ) : (
          <Plus size={14} strokeWidth={1.75} />
        )}
      </button>
    </form>
  );
}
