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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { unwrapApi } from "@/lib/utils/api-fetch";

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
        //
        // NOTE the shape: `{ ok, warning }` has an `ok` field but no `meta`,
        // so it is NOT the API envelope and `unwrapApi` must not touch it.
        // That distinction is pinned by a test in tests/lib/api-fetch.test.ts.
        const data = unwrapApi<{
          ok: boolean;
          warning?: string;
        }>(await res.json(), res.status);
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
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onClose();
      }}
    >
      <DialogContent
        unstyled
        showCloseButton={false}
        overlayClassName="z-50 bg-canvas/60"
        className={cn(
          "fixed inset-x-0 bottom-0 z-[51] max-h-[90dvh] overflow-y-auto rounded-t-float border-t border-edge-default bg-overlay outline-none lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:w-full lg:max-w-md lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-overlay lg:border",
          "shadow-l2",
          "pb-[env(safe-area-inset-bottom,0px)]",
        )}
      >
        <header className="flex items-center gap-2 border-b border-edge-subtle px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              mission complete
            </p>
            <DialogTitle className="mt-0.5 truncate text-[15px] font-semibold text-fg">
              {missionTitle}
            </DialogTitle>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-control text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </header>

        <div className="px-4 py-3 space-y-3">
          <p className="text-[13px] text-fg-secondary leading-snug">
            What worked? What to do next time? Nick reads these so future picks
            land sharper. <span className="text-fg-tertiary">Skip if you&apos;d rather move on.</span>
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
              "w-full rounded-control border bg-content px-3 py-2 text-[16px] text-fg placeholder:text-fg-tertiary/70 transition-colors duration-[var(--motion-state)]",
              "border-edge-default focus:border-accent focus:outline-none",
              "resize-none disabled:opacity-50",
            )}
          />

          {error && (
            <p className="rounded-control border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-300/90">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-edge-subtle px-4 py-3">
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={submitting}
            className="min-h-11 px-2 text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg disabled:opacity-50"
          >
            skip + archive
          </button>
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={submitting || !text.trim()}
            className={cn(
              "ml-auto inline-flex min-h-11 items-center gap-2 rounded-control bg-accent px-4 py-2 text-[14px] font-semibold text-[var(--text-inverse)] hover:bg-accent-hover",
              "disabled:opacity-50 transition-colors duration-[var(--motion-state)]",
            )}
          >
            {submitting && (
              <Loader2 size={12} className="animate-spin" strokeWidth={2} />
            )}
            save retro + archive
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
