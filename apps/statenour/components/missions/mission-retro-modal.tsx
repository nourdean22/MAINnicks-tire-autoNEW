"use client";

/**
 * MissionRetroModal · Wave AA Phase 3 · 2026-05-28.
 *
 * Opens when the operator completes a mission · either via explicit
 * "complete mission" tap OR via cascade when the last open task in an
 * active mission gets ticked done. Captures a short retro (what worked,
 * what to do next time) + writes to BrainMemory(category=mission_retro)
 * + marks the mission archived.
 *
 * Sam-layer · this is the compound-feature that makes /missions worth
 * something Linear / Todoist can't ship: the operator's BrainMemory
 * grows with closed-mission learnings over time. Every retro becomes a
 * future input for Nick's morning brief + Nick's pick scoring.
 *
 * Mobile-friendly · backdrop tap to close · iOS safe-area padding.
 * Operator can dismiss without writing a retro · the mission still
 * archives so the surface clears.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MissionRetroModalProps {
  missionId: string;
  missionTitle: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function MissionRetroModal({
  missionId,
  missionTitle,
  onClose,
  onSaved,
}: MissionRetroModalProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount · iOS Safari blocks programmatic focus
  // outside a gesture but the operator tapped "complete mission" or
  // ticked the last task in the same tick · the focus call succeeds.
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  // Esc + backdrop close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const handleSave = useCallback(
    async (skip: boolean) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/missions/${missionId}/retro`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            retroText: skip ? "" : text.trim(),
            archive: true,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // wave-AA-audit · partial-success surfaces · if the BrainMemory
        // write failed but the archive succeeded, the server returns
        // { ok:true, warning:"retro_write_failed" }. Don't lie to the
        // operator · keep the modal open with the retro text intact so
        // they can retry.
        const data = (await res.json()) as {
          ok: boolean;
          warning?: string;
        };
        if (data.warning === "retro_write_failed") {
          setError(
            "Mission archived, but the retro note didn't save. Try again — your text is still here.",
          );
          setSubmitting(false);
          return;
        }
        await onSaved();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [missionId, text, onSaved],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="mission retro"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full lg:max-w-md bg-[var(--bg-base)] border-t lg:border border-[var(--gold)]/30 rounded-t-2xl lg:rounded-2xl",
          "max-h-[90vh] overflow-y-auto",
          "shadow-[0_-20px_60px_rgba(0,0,0,0.5),0_0_40px_rgba(253,185,19,0.1)]",
          "pb-[env(safe-area-inset-bottom,0px)]",
        )}
      >
        <header className="flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
              mission complete
            </p>
            <h2 className="text-[14px] font-bold text-[var(--text-primary)] truncate mt-0.5">
              {missionTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/15 disabled:opacity-50"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div className="px-4 py-3 space-y-3">
          <p className="text-[12px] text-[var(--text-secondary)] leading-snug">
            What worked? What to do next time? Nick reads these so future picks
            land sharper. <span className="text-[var(--text-tertiary)]">Skip if you&apos;d rather move on.</span>
          </p>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={submitting}
            placeholder="2 lines · what shipped, what dragged…"
            rows={4}
            className={cn(
              // wave-AB.d-mobile · 14px → 16px · operator types the retro
              // on phones · iOS no-zoom floor.
              "w-full rounded-md border bg-[var(--bg-raised)]/[0.08] px-3 py-2 text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/70 transition-colors",
              "border-[var(--border-default)] focus:border-[var(--gold)]/40 focus:outline-none focus:shadow-[0_0_18px_rgba(253,185,19,0.12)]",
              "resize-none disabled:opacity-50",
            )}
          />

          {error && (
            <p className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-300/90">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-[var(--border-default)] px-4 py-3">
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={submitting}
            className="text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-50"
          >
            skip + archive
          </button>
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={submitting || !text.trim()}
            className={cn(
              "ml-auto inline-flex items-center gap-2 rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15 px-3 py-2 text-[12px] font-medium",
              "disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40",
            )}
          >
            {submitting && (
              <Loader2 size={12} className="animate-spin" strokeWidth={2} />
            )}
            save retro + archive
          </button>
        </footer>
      </div>
    </div>
  );
}
