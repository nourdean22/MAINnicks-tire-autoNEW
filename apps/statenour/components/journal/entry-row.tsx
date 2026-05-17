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
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ChevronRight, Link2, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SOURCE_ICON,
  TYPE_META,
  type FeedEntry,
  type TypeKey,
} from "@/components/journal/types";

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
