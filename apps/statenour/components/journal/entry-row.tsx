"use client";

/**
 * JournalEntryRow · v10.0.284 · single-entry row for the /journal feed
 * surface, extracted from app/(mastery)/journal/page.tsx (was ~160 lines
 * of inline JSX at module-scope, lines ~476-635).
 *
 * Pure relocation · no behavior change vs the inline version. Same
 * props, same TYPE_META/SOURCE_ICON lookup, same expanded-body layout.
 *
 * Mirrors the ProjectCard extraction pattern (v10.0.273):
 *   · component owns its own JSX + icon imports
 *   · types and styling maps live in components/journal/types.ts so
 *     the page filter UI can also import TYPE_META without circular
 *     reference back through this file
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ChevronRight, Link2, NotebookPen, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SOURCE_ICON,
  TYPE_META,
  type FeedEntry,
  type TypeKey,
} from "@/components/journal/types";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";

interface JournalEntryRowProps {
  entry: FeedEntry;
  isExpanded: boolean;
  onToggle: () => void;
  delay: number;
}

export function JournalEntryRow({
  entry,
  isExpanded,
  onToggle,
  delay,
}: JournalEntryRowProps) {
  const typeKey = (entry.entryType || "raw") as Exclude<TypeKey, "all">;
  const meta = TYPE_META[typeKey] || TYPE_META.raw;
  const TypeIcon = meta.icon;
  const SourceIcon = SOURCE_ICON[entry.source] || NotebookPen;

  const time = new Date(entry.createdAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      id={`bd-${entry.id}`}
      className={cn(
        "rounded-lg border transition-all stagger-in scroll-mt-24",
        meta.border,
        meta.bg,
        "hover:border-[var(--text-tertiary)]"
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <button
        type="button"
        onClick={onToggle}
        // v10.0.529.21 a11y · aria-expanded for the row toggle so
        // screen readers announce open/closed state · focus-visible
        // ring matches the rest of the surface's keyboard nav.
        aria-expanded={isExpanded}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/40 focus-visible:ring-inset rounded"
      >
        {/* Type icon */}
        <div className={cn("shrink-0 mt-0.5", meta.color)}>
          <TypeIcon size={13} />
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              className={cn(
                "text-[8px] h-3.5 px-1.5 border",
                meta.bg,
                meta.border,
                meta.color
              )}
            >
              {meta.label}
            </Badge>
            <span className="text-[8px] font-mono text-[var(--text-tertiary)] flex items-center gap-0.5">
              <SourceIcon size={8} />
              {entry.source}
            </span>
            {entry.mood && (
              <span className="text-[8px] italic text-[var(--text-tertiary)]">· {entry.mood}</span>
            )}
            <span className="text-[8px] font-mono text-[var(--text-tertiary)] ml-auto">{time}</span>
          </div>
          <p className="text-[12px] text-[var(--text-primary)] mt-1 line-clamp-2 leading-snug">
            {entry.title}
          </p>
          {entry.domains.length > 0 && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {entry.domains.slice(0, 4).map((d) => (
                <span
                  key={d}
                  className="text-[8px] uppercase tracking-wider text-[var(--text-tertiary)] font-mono"
                >
                  #{d}
                </span>
              ))}
              {entry.tasksCreated > 0 && (
                <span className="text-[8px] font-mono text-emerald-400/80">
                  +{entry.tasksCreated} task{entry.tasksCreated > 1 ? "s" : ""}
                </span>
              )}
              {entry.acknowledged === false && entry.actionable && (
                <span className="text-[8px] font-bold text-red-400">NEEDS REVIEW</span>
              )}
            </div>
          )}
        </div>

        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 text-[var(--text-tertiary)] transition-transform mt-1",
            isExpanded && "rotate-90"
          )}
        />
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-800/40 pt-2 ml-[calc(13px+12px)]">
          {entry.summary && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
                Summary
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                {entry.summary}
              </p>
            </div>
          )}
          {entry.body && entry.body !== entry.title && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
                Raw
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                {entry.body}
              </p>
            </div>
          )}
          {entry.linkedTopics.length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5 flex items-center gap-1">
                <Link2 size={9} /> Linked
              </p>
              <div className="flex flex-wrap gap-1">
                {entry.linkedTopics.map((t) => (
                  <Badge
                    key={t}
                    className="text-[9px] bg-zinc-800/60 text-zinc-300 border border-zinc-700/40"
                  >
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {entry.confidence !== undefined && (
            <p className="text-[9px] text-[var(--text-tertiary)] font-mono">
              confidence {Math.round(entry.confidence * 100)}%
            </p>
          )}

          {/* 2026-05-24 · Wave S #1 · Margin contradictions on
              brain-dump entries · queries contradictionsForEntry only
              when expanded (lazy · saves the round-trip when operator
              just scans the feed). Silent when no contradictions
              found · matches the existing "silent unless signal"
              page-level convention. */}
          {entry.source === "dump" && (
            <EntryContradictions brainMemoryId={entry.id} />
          )}

          {/* 2026-05-24 · Wave S #2 · Prediction-line on decision
              entries · captures "you predict X by Y" so the existing
              predictions-grader cron can resolve it later. Persists
              into the existing Prediction model · no schema changes ·
              feeds the Brier score + calibration pipeline. */}
          {entry.entryType === "decision" && (
            <EntryPredictionForm sourceEntryId={entry.id} />
          )}
          {/* v10.0.30 — "needs acknowledgment" indicator gated behind
              an env feature flag. Pre-v10.0.30 it always rendered
              but pointed at /api/journal/:id/ack which doesn't exist
              yet — surfacing a state the operator can't act on adds
              cognitive load with no payoff. Now: hidden until the
              endpoint ships AND NEXT_PUBLIC_JOURNAL_ACK is set. */}
          {entry.acknowledged === false &&
            entry.actionable &&
            process.env.NEXT_PUBLIC_JOURNAL_ACK === "1" && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--gold)]">
                <CheckCircle2 size={10} /> needs acknowledgment
              </span>
            )}
        </div>
      )}
    </div>
  );
}

/**
 * Wave S #1 · per-entry contradictions (2026-05-24).
 *
 * Lazy-fetches contradictions tied to a brain-dump's underlying
 * BrainMemory id. Renders only when results exist · operator sees
 * "⚠ 2 contradictions" with each on a row that shows the conflicting
 * excerpt + days-apart. No mutation here — resolving lives in the
 * MemoryCalibration ritual which the operator opens separately.
 */
function EntryContradictions({ brainMemoryId }: { brainMemoryId: string }) {
  const { data } = trpc.journal.contradictionsForEntry.useQuery(
    { brainMemoryId },
    { refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  );
  if (!data || data.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-md border border-amber-500/20 bg-amber-500/[0.03] p-2">
      <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-300">
        <AlertTriangle size={9} aria-hidden /> {data.length}{" "}
        contradiction{data.length === 1 ? "" : "s"}
      </p>
      <ul className="space-y-1">
        {data.map((c) => (
          <li
            key={c.key}
            className="text-[10px] leading-snug text-[var(--text-secondary)]"
          >
            <span className="font-mono text-amber-400/60 mr-1">
              {c.signal}
            </span>
            <span className="italic">&ldquo;{c.excerpt.slice(0, 140)}&rdquo;</span>
            <span className="ml-1 font-mono text-[var(--text-tertiary)]">
              · {c.daysApart}d apart
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Wave S #2 · per-entry prediction-line (2026-05-24).
 *
 * Decision-class entries get a small "predict outcome" button. Click
 * reveals a one-line form (prediction text + target date). Submit
 * writes to the existing Prediction model with kind="binary"·
 * predictions-grader cron resolves it once the date passes. The
 * sourceEntryId is stored in `basis` so the entry → prediction link
 * is traceable.
 */
function EntryPredictionForm({ sourceEntryId }: { sourceEntryId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [saved, setSaved] = useState(false);
  const mutation = trpc.journal.savePrediction.useMutation();
  if (saved) {
    return (
      <p className="flex items-center gap-1 text-[10px] text-emerald-300">
        <Target size={10} aria-hidden /> prediction saved · grader will score
        on {date}
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/[0.05] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-violet-300 hover:bg-violet-500/15 transition-colors"
      >
        <Target size={10} aria-hidden /> predict outcome
      </button>
    );
  }
  // Default to 30 days out · most decisions resolve within a month.
  const defaultDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  })();
  return (
    <div className="space-y-1.5 rounded-md border border-violet-500/30 bg-violet-500/[0.04] p-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-violet-300">
        Predict outcome
      </p>
      <input
        type="text"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What will happen by the target date?"
        className="w-full rounded border border-violet-500/30 bg-[var(--bg-void)] px-2 py-1 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
        maxLength={500}
      />
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date || defaultDate}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-violet-500/30 bg-[var(--bg-void)] px-2 py-1 text-[10px] font-mono text-[var(--text-secondary)]"
        />
        <button
          type="button"
          disabled={!text.trim() || mutation.isPending}
          onClick={async () => {
            const result = await mutation.mutateAsync({
              prediction: text.trim(),
              targetDate: date || defaultDate,
              sourceEntryId,
            });
            if (result.ok) {
              setSaved(true);
            } else {
              toast.error("couldn't save prediction · retry?");
            }
          }}
          className="rounded border border-violet-500/40 bg-violet-500/15 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-violet-200 hover:bg-violet-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {mutation.isPending ? "saving…" : "save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setText("");
          }}
          className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:bg-zinc-800/40 transition-colors"
        >
          cancel
        </button>
      </div>
    </div>
  );
}
