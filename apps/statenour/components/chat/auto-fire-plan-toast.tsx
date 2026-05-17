"use client";

/**
 * AutoFirePlanToast — replaces the silent auto-fire useEffect.
 *
 * v6 · Apr 28 · Feature C + E + #5 combined.
 *
 * Renders a 2.5s countdown chip with the image-gen plan card AND
 * Go/Edit/Cancel buttons. Auto-fires when the countdown hits zero
 * UNLESS user cancels or edits. While image is rendering, the same
 * chip morphs into a Cancel button.
 *
 * Power moves wired:
 *   · Auto-countdown gives Nour 2.5s grace to abort
 *   · Plan card surfaces subject + format + angle + speed BEFORE firing
 *   · Edit button opens an inline prompt editor (override the plan)
 *   · Cancel button kills the whole flow + adds skip key to autoFiredRef
 *   · Render-cancel button stops the in-flight image gen mid-flight
 *   · Confidence badge shows how sure the planner is (low = ASK first)
 *
 * Design intent: "auto" without "silent". Nour always sees what's
 * about to happen + has 1-tap power to adjust.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils/cn";
import {
  Sparkles,
  X,
  Pencil,
  Send,
  Loader2,
  Camera,
  Wand2,
} from "lucide-react";
import type { AutoFirePlan } from "@/lib/chat/auto-fire-gate";

interface Props {
  plan: AutoFirePlan;
  /** Called when user (or countdown) decides to fire the image gen. */
  onProceed: (finalPrompt: string) => void;
  /** Called when user cancels — kills auto-fire for this message id. */
  onCancel: () => void;
  /** Optional pre-flight delay in ms (default 2500). 0 = fire immediately. */
  countdownMs?: number;
  /** True while the image is currently being rendered server-side. */
  isRendering?: boolean;
  /** Called when user hits the abort button during render. */
  onAbortRender?: () => void;
}

export function AutoFirePlanToast({
  plan,
  onProceed,
  onCancel,
  countdownMs = 2500,
  isRendering = false,
  onAbortRender,
}: Props) {
  const [remaining, setRemaining] = useState(countdownMs);
  const [editing, setEditing] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(plan.imagePrompt);
  const [paused, setPaused] = useState(false);
  const firedRef = useRef(false);

  // Countdown — single interval, paused when editing or hovering
  useEffect(() => {
    if (paused || editing || isRendering) return;
    if (firedRef.current) return;
    if (remaining <= 0) {
      firedRef.current = true;
      onProceed(draftPrompt);
      return;
    }
    const id = window.setTimeout(() => setRemaining((r) => Math.max(0, r - 100)), 100);
    return () => window.clearTimeout(id);
  }, [remaining, paused, editing, isRendering, onProceed, draftPrompt]);

  const proceedNow = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onProceed(draftPrompt);
  }, [onProceed, draftPrompt]);

  const cancel = useCallback(() => {
    firedRef.current = true; // prevent countdown from firing
    onCancel();
  }, [onCancel]);

  const lowConfidence = plan.confidence < 0.5;
  const progressPct = Math.max(0, (remaining / countdownMs) * 100);

  // ── Render mode (image is being generated) ─────────────────────────
  if (isRendering) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-amber-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-amber-300/80 mb-0.5">
            Rendering · {plan.subject} · {plan.format}
          </div>
          <div className="text-xs text-zinc-300 truncate font-mono">
            {draftPrompt.slice(0, 100)}...
          </div>
        </div>
        {onAbortRender && (
          <button
            type="button"
            onClick={onAbortRender}
            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] font-mono text-rose-200 hover:bg-rose-500/15 transition-colors flex items-center gap-1 shrink-0"
            title="Abort image render"
          >
            <X className="h-3 w-3" />
            STOP
          </button>
        )}
      </div>
    );
  }

  // ── Edit mode (user tapped Edit) ───────────────────────────────────
  if (editing) {
    return (
      <div className="rounded-lg border border-violet-500/40 bg-violet-500/[0.05] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Pencil className="h-3.5 w-3.5 text-violet-300" />
          <span className="text-[10px] uppercase tracking-wider text-violet-300">
            Edit image prompt
          </span>
          <button
            type="button"
            onClick={() => {
              setDraftPrompt(plan.imagePrompt);
              setEditing(false);
            }}
            className="ml-auto text-[10px] text-zinc-400 hover:text-zinc-200"
          >
            reset
          </button>
        </div>
        <textarea
          value={draftPrompt}
          onChange={(e) => setDraftPrompt(e.target.value)}
          className="w-full min-h-[80px] rounded-md border border-white/10 bg-black/40 p-2 text-xs text-zinc-100 outline-none focus:border-violet-500/60 font-mono"
          autoFocus
        />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              proceedNow();
            }}
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono text-emerald-200 hover:bg-emerald-500/15 flex items-center gap-1"
          >
            <Send className="h-3 w-3" />
            FIRE
          </button>
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border border-zinc-500/30 bg-zinc-500/5 px-2 py-1 text-[10px] font-mono text-zinc-400 hover:bg-zinc-500/10"
          >
            cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Default: countdown plan card ───────────────────────────────────
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors relative overflow-hidden",
        lowConfidence
          ? "border-amber-500/40 bg-amber-500/[0.04]"
          : "border-emerald-500/40 bg-emerald-500/[0.04]",
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Progress bar (countdown) */}
      <div
        className={cn(
          "absolute bottom-0 left-0 h-0.5 transition-[width]",
          lowConfidence ? "bg-amber-400/70" : "bg-emerald-400/70",
        )}
        style={{ width: `${progressPct}%` }}
      />

      <div className="flex items-start gap-2 mb-2">
        <div className={cn(
          "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
          lowConfidence ? "bg-amber-500/15" : "bg-emerald-500/15",
        )}>
          <Wand2 className={cn("h-3.5 w-3.5", lowConfidence ? "text-amber-300" : "text-emerald-300")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-200">
              {paused ? "Auto-fire paused — hover to release" : "Auto-firing image"}
            </span>
            <span className="text-[10px] font-mono tabular-nums opacity-70 ml-auto">
              {(remaining / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="text-[11px] text-zinc-300 leading-snug">
            <span className="font-mono">subject:</span> <span className="font-medium">{plan.subject}</span>
            <span className="text-zinc-600"> · </span>
            <span className="font-mono">{plan.format}</span>
            <span className="text-zinc-600"> · </span>
            <span className="font-mono">{plan.angle}</span>
            <span className="text-zinc-600"> · </span>
            <span className="font-mono text-amber-300">{plan.speed}</span>
          </div>
          <div className="text-[9px] text-zinc-500 mt-0.5 font-mono">
            confidence {(plan.confidence * 100).toFixed(0)}%
            {lowConfidence && " — low, consider editing"}
          </div>
        </div>
      </div>

      <div className="flex gap-1 mt-2">
        <button
          type="button"
          onClick={proceedNow}
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/15 transition-colors flex items-center gap-1"
        >
          <Camera className="h-3 w-3" />
          GO NOW
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-violet-200 hover:bg-violet-500/15 transition-colors flex items-center gap-1"
        >
          <Pencil className="h-3 w-3" />
          EDIT
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-md border border-rose-500/35 bg-rose-500/[0.06] px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-rose-200 hover:bg-rose-500/15 transition-colors flex items-center gap-1 ml-auto"
        >
          <X className="h-3 w-3" />
          CANCEL
        </button>
      </div>

      {lowConfidence && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/[0.03] p-1.5 text-[10px] text-amber-200/80">
          <Sparkles className="h-2.5 w-2.5 inline mr-1" />
          Plan confidence low — subject may be wrong. Tap Edit to refine.
        </div>
      )}
    </div>
  );
}
