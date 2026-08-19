"use client";

/**
 * MEMORY CALIBRATION RITUAL — verify / update / retire old beliefs.
 *
 * Fetches 1-3 aging brain memories that might be stale and asks Nour to
 * rule on each. Three outcomes per memory:
 *   • verify → confidence + 0.1, lastSeen = now ("still true")
 *   • update → enter new text, confidence reset to 0.8 ("partial / evolved")
 *   • retire → expiresAt = now, stops surfacing ("no longer true")
 *
 * This is the active half of the reflect → calibrate loop. Reflections
 * are the NEW observations; calibration re-weights the OLD beliefs so
 * Nick's system prompt stays aligned with current-Nour, not past-Nour.
 *
 * Mounted inline under the reflect composer AND available as a standalone
 * card in Ultron's signal zone via the MemoryCalibrationCard wrapper.
 */

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import {
  RotateCcw, Check, Edit3, Trash2, X as XIcon, Loader2, ArrowRight,
} from "lucide-react";
// 2026-08-19 · this row printed `seen {seenCount}×` and `c{confidence*100}`
// side by side — the same fact twice, since confidence IS the sighting
// counter. The count is the fact; the number dressed as a score was noise.
import { describeSeenCount } from "@/lib/brain/attention-label";

interface MemorySample {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  ageDays: number;
  seenCount: number;
  source: string | null;
}

interface CalibrationProps {
  onClose?: () => void;
  /** When true, auto-loads 3 samples on mount. Default true. */
  autoLoad?: boolean;
}

const CATEGORY_COLOR: Record<string, string> = {
  pattern:    "text-violet-400",
  insight:    "text-blue-400",
  preference: "text-emerald-400",
  feedback:   "text-amber-400",
  wisdom:     "text-[var(--gold)]",
  rule:       "text-pink-400",
  routine:    "text-cyan-400",
  identity:   "text-red-400",
};

export function MemoryCalibrationRitual({ onClose, autoLoad = true }: CalibrationProps) {
  // Phase TT.2 (2026-05-22) · REST→tRPC · the aging-beliefs read is now
  // trpc.journal.calibrationSamples.useQuery, gated by `autoLoad` via
  // the `enabled` flag (matches the old "only load when autoLoad" rule).
  // `act` removes an actioned memory by tracking its id in `actedIds` ·
  // the rendered list is the query data minus that set, so there's no
  // local mirror to keep in sync (no setState-in-effect).
  const samplesQuery = trpc.journal.calibrationSamples.useQuery(undefined, {
    enabled: autoLoad,
    refetchOnWindowFocus: false,
  });
  const [actedIds, setActedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  // The list the UI renders: fetched samples minus the ones the
  // operator already ruled on this session.
  const samples = useMemo<MemorySample[]>(() => {
    const fetched = samplesQuery.data?.samples ?? [];
    return actedIds.size === 0
      ? fetched
      : fetched.filter((m) => !actedIds.has(m.id));
  }, [samplesQuery.data, actedIds]);

  // autoLoad=false → query never fires → not loading. autoLoad=true →
  // mirror React Query's isLoading exactly.
  const loading = autoLoad && samplesQuery.isLoading;
  // reshuffle · refetch + clear the acted-on set so the new picks all show.
  const load = () => {
    setActedIds(new Set());
    return samplesQuery.refetch();
  };

  // Phase TT.2 · the verify/update/retire ruling is now a typed
  // mutation · the strict calibrationRulingSchema input means the
  // payload can't drift from what the server expects.
  const calibrateMutation = trpc.journal.calibrate.useMutation();

  const act = async (id: string, action: "verify" | "update" | "retire", newContent?: string) => {
    setWorking(id);
    try {
      await calibrateMutation.mutateAsync({ id, action, newContent });
      // Remove from view — no re-surface for this memory in this session
      setActedIds((prev) => new Set(prev).add(id));
      setEditing(null);
      setDraft("");
      toast.success(
        action === "verify" ? "verified · confidence up"
        : action === "update" ? "updated"
        : "retired · won't resurface",
      );
    } catch {
      toast.error("failed");
    } finally {
      setWorking(null);
    }
  };

  const beginEdit = (m: MemorySample) => {
    setEditing(m.id);
    setDraft(m.content);
  };
  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] p-2 flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-emerald-400" />
        <span className="text-[10px] text-[var(--text-tertiary)]">pulling 3 aging beliefs…</span>
      </div>
    );
  }

  if (samples.length === 0) {
    return (
      <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-void)]/40 p-2 flex items-center gap-2">
        <Check size={12} className="text-emerald-400" />
        <span className="text-[10px] text-[var(--text-secondary)]">
          memory bank calibrated · nothing aging worth re-checking
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto text-[var(--text-tertiary)] hover:text-red-400"
            aria-label="close"
          >
            <XIcon size={11} />
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <RotateCcw size={11} className="text-emerald-400" />
        <span className="text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-emerald-400">
          calibrate memory
        </span>
        <span className="text-[8px] font-mono text-[var(--text-tertiary)]">
          {samples.length} aging
        </span>
        <button
          onClick={load}
          className="ml-auto text-[9px] text-[var(--text-tertiary)] hover:text-emerald-400 flex items-center gap-0.5"
          title="reshuffle"
        >
          <RotateCcw size={9} /> reshuffle
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-red-400"
            aria-label="close"
          >
            <XIcon size={11} />
          </button>
        )}
      </div>

      <ul className="space-y-1.5">
        {samples.map((m) => {
          const isEditing = editing === m.id;
          const isWorking = working === m.id;
          const catColor = CATEGORY_COLOR[m.category] ?? "text-[var(--text-tertiary)]";
          return (
            <li
              key={m.id}
              className={cn(
                "rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] p-2",
                isWorking && "opacity-50 pointer-events-none",
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn("text-[8px] font-bold uppercase tracking-wider", catColor)}>
                  {m.category}
                </span>
                <span className="text-[8px] font-mono text-[var(--text-tertiary)]">
                  · {m.ageDays}d old · {describeSeenCount(m.seenCount)}
                </span>
              </div>

              {isEditing ? (
                <>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    className="w-full text-[11px] leading-snug rounded-md bg-[var(--bg-void)] border border-emerald-500/30 px-2 py-1.5 text-[var(--text-primary)] focus:border-emerald-500/60 focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      onClick={() => act(m.id, "update", draft)}
                      disabled={!draft.trim()}
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-[9px] font-bold uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                    >
                      <Check size={9} /> save update
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] hover:text-red-400"
                    >
                      <XIcon size={9} /> cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-[var(--text-primary)] leading-snug mb-1.5">
                    {m.content}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => act(m.id, "verify")}
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-[9px] font-bold uppercase tracking-wider text-emerald-400 hover:bg-emerald-500/20"
                    >
                      <Check size={9} /> still true
                    </button>
                    <button
                      onClick={() => beginEdit(m)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 text-[9px] font-bold uppercase tracking-wider text-blue-400 hover:bg-blue-500/20"
                    >
                      <Edit3 size={9} /> update
                    </button>
                    <button
                      onClick={() => act(m.id, "retire")}
                      className="flex items-center gap-1 px-2 py-0.5 rounded border border-red-500/30 bg-red-500/5 text-[9px] font-bold uppercase tracking-wider text-red-400 hover:bg-red-500/15"
                    >
                      <Trash2 size={9} /> retire
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Wrapper for the Ultron signal zone — shows a thin CTA that expands
 * into the full ritual on click. Only surfaces 1× per day via localStorage
 * so it doesn't nag.
 */
export function MemoryCalibrationCard() {
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const last = localStorage.getItem("ultron:calibrate:last-shown");
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      if (last === todayStr) setHidden(true);
    } catch {}
  }, []);

  const markShown = () => {
    try {
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      localStorage.setItem("ultron:calibrate:last-shown", todayStr);
    } catch {}
  };

  if (hidden) return null;

  if (!expanded) {
    return (
      <section className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 flex items-center gap-2">
        <RotateCcw size={10} className="text-emerald-400" />
        <span className="text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-emerald-400">
          calibrate memory
        </span>
        <span className="text-[10px] text-[var(--text-secondary)] truncate">
          3 aging beliefs · re-rule them in 30s
        </span>
        <button
          onClick={() => { setExpanded(true); markShown(); }}
          className="ml-auto flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400 hover:underline"
        >
          start <ArrowRight size={9} />
        </button>
        <button
          onClick={() => { setHidden(true); markShown(); }}
          className="text-[var(--text-tertiary)] hover:text-red-400"
          aria-label="dismiss for today"
        >
          <XIcon size={10} />
        </button>
      </section>
    );
  }

  return (
    <MemoryCalibrationRitual
      onClose={() => { setExpanded(false); setHidden(true); markShown(); }}
      autoLoad
    />
  );
}
