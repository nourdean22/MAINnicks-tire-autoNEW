"use client";

/**
 * components/ui/outcome-dialog.tsx · the completion moment's one question.
 *
 * 2026-08-19 · outcome-loop wave. Task.outcomeRating/outcomeLesson had
 * ZERO producers — auto-learn's rating multiplier and lesson capture
 * were built, tested and unreachable, because no completion surface
 * ever asked. This is the ask: a Promise-based hook in the exact
 * useConfirmDialog/usePromptDialog idiom (same base-ui dialog, same
 * race-free resolve capture, iOS-PWA-safe — window.prompt is suppressed
 * in standalone mode).
 *
 * Speed contract: rating a completion costs ONE tap — the chips resolve
 * immediately, carrying whatever lesson text is in the box. "just done"
 * resolves {rating:null} (lesson still carried if typed). Escape /
 * outside-click resolves null — "dismissed without answering".
 *
 * ★ Callers MUST treat null as complete-unrated, never as cancel. The
 * prompt-fatigue literature (Apple review-prompt caps, ESM compliance
 * decay) is unambiguous: gating the primary action on a rating prompt
 * punishes dismissal and breeds reflexive garbage ratings — which then
 * poison the mastery multiplier. Also: don't prompt recurring loops.
 *
 *   const { collectOutcome, dialog } = useOutcomeDialog();
 *   const outcome = await collectOutcome({ title: "how did it go?" });
 *   complete({
 *     outcomeRating: outcome?.rating ?? undefined,   // null → unrated
 *     outcomeLesson: outcome?.lesson ?? undefined,
 *   });
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { outcomeRatingValues } from "@/lib/validators/tasks";

export type OutcomeRatingValue = (typeof outcomeRatingValues)[number];

export interface OutcomeCapture {
  rating: OutcomeRatingValue | null;
  lesson: string | null;
}

export interface OutcomeOptions {
  title: string;
  body?: string;
}

interface OutcomeState extends OutcomeOptions {
  open: boolean;
  lesson: string;
  resolve: ((value: OutcomeCapture | null) => void) | null;
}

const INITIAL_STATE: OutcomeState = {
  open: false,
  resolve: null,
  title: "",
  lesson: "",
};

/** Chip order mirrors the OutcomeRating enum, best → worst. Lowercase
 *  labels match the desk's editorial voice ("done · whisperer next"). */
const RATING_CHIPS: ReadonlyArray<{
  value: OutcomeRatingValue;
  label: string;
  className: string;
}> = [
  { value: "OUTSTANDING", label: "outstanding", className: "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" },
  { value: "SATISFACTORY", label: "solid", className: "border-sky-500/40 text-sky-400 hover:bg-sky-500/10" },
  { value: "SUBSTANDARD", label: "weak", className: "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" },
  { value: "FAILED", label: "failed", className: "border-rose-500/40 text-rose-400 hover:bg-rose-500/10" },
];

export function useOutcomeDialog(): {
  collectOutcome: (options: OutcomeOptions) => Promise<OutcomeCapture | null>;
  dialog: React.ReactNode;
} {
  const [state, setState] = React.useState<OutcomeState>(INITIAL_STATE);

  const collectOutcome = React.useCallback(
    (options: OutcomeOptions): Promise<OutcomeCapture | null> => {
      return new Promise<OutcomeCapture | null>((resolve) => {
        setState((prev) => {
          // Reentrancy guard (2026-08-19 review): this hook is a page-level
          // singleton shared by every board row. Without this, a second
          // completion while a prompt is open OVERWRITES the first caller's
          // resolver — its await never settles and that row's checkbox
          // stays disabled until reload. Settle the superseded caller as
          // "dismissed" (null → callers complete unrated), same outcome as
          // the operator tapping away. Resolving an already-settled promise
          // is a no-op, so a StrictMode double-run of this updater is safe.
          prev.resolve?.(null);
          return { ...options, open: true, resolve, lesson: "" };
        });
      });
    },
    [],
  );

  const { resolve } = state;
  const handleClose = React.useCallback(
    (value: OutcomeCapture | null) => {
      // Same race-free capture pattern as useConfirmDialog — read the
      // resolver before the async state reset can clear it.
      resolve?.(value);
      setState(INITIAL_STATE);
    },
    [resolve],
  );

  const submit = (rating: OutcomeRatingValue | null) => {
    const lesson = state.lesson.trim();
    handleClose({ rating, lesson: lesson ? lesson : null });
  };

  // No autofocus anywhere: popping the iOS keyboard on every completion
  // would tax the 1-tap fast path. The lesson field focuses only when
  // deliberately tapped.
  const dialog = (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        // Escape / outside-click / close = cancel the completion itself.
        if (!open) handleClose(null);
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          <DialogDescription>
            {state.body ?? "one tap teaches Nick — ratings scale what this task's domain learns."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {RATING_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => submit(chip.value)}
                className={cn(
                  "min-h-12 rounded-lg border bg-[var(--bg-base)]/40 px-3 text-sm font-medium transition-colors",
                  chip.className,
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            aria-label="lesson learned"
            value={state.lesson}
            onChange={(e) => setState((s) => ({ ...s, lesson: e.target.value }))}
            placeholder="lesson learned — optional, becomes memory"
            maxLength={5000}
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)]/40 px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-hover)] focus:outline-none"
          />
          <Button
            variant="outline"
            type="button"
            onClick={() => submit(null)}
            className="w-full"
          >
            just done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { collectOutcome, dialog };
}
