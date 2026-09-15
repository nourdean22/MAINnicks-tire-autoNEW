"use client";

/**
 * BriefLead — section 2, the intellectual center: ONE recommended move with
 * its real reasons, plus at most two quiet alternatives. Replaces the
 * ExecutiveActionMatrix (gradient glass, two panes, five nested arm
 * components) with typography.
 *
 * HAX-guideline shape deliberately: the recommendation is explained
 * ("Why this?" expands the builder's `reasoning` receipts — scorer
 * explanation strings, never a fabricated confidence %), correctable
 * ("Different move" reveals ranked alternatives), and dismissible (it's
 * one tap of scroll — nothing traps focus).
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronUp, Eye } from "lucide-react";
import type { BriefLeadSection } from "@/lib/home/operator-brief";
import { cn } from "@/lib/utils/cn";
import { useInspector } from "@/hooks/use-inspector";

/** Section-kind accents — one semantic color per meaning, nothing else. */
const KIND_TONE: Record<BriefLeadSection["kind"], string> = {
  error: "text-rose-300",
  execute: "text-gold",
  resume: "text-gold",
  decide: "text-rose-300",
  hygiene: "text-amber-300",
  triage: "text-amber-300",
  suggestions: "text-fg-secondary",
};

export function BriefLead({
  lead,
  loading,
}: {
  lead: BriefLeadSection | null;
  loading: boolean;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  // 2026-09-15 · a concrete task lead opens the universal task inspector in
  // place: the scorer's per-term breakdown, next action, definition of done —
  // without leaving Home. The CTA still goes to the board.
  const { openInspector } = useInspector();

  if (loading) {
    return (
      <section aria-label="the brief" className="mt-7 space-y-3" aria-busy>
        <div className="h-3 w-24 animate-pulse rounded bg-raised" />
        <div className="h-7 w-3/4 animate-pulse rounded bg-raised" />
        <div className="h-4 w-full animate-pulse rounded bg-raised" />
      </section>
    );
  }
  if (!lead) return null;

  const tone = KIND_TONE[lead.kind];

  return (
    <section aria-label="the brief" className="mt-7">
      <p className={cn("text-[10px] font-mono font-semibold uppercase tracking-[0.2em]", tone)}>
        {lead.headline}
      </p>

      <p className="mt-2 max-w-[56ch] text-pretty text-[15px] leading-relaxed text-fg-secondary">
        {lead.body}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2">
        {lead.cta && (
          <Link
            href={lead.cta.href}
            className="group inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-gold px-4 text-[13px] font-semibold text-black transition-colors duration-150 hover:bg-gold-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {lead.cta.label}
            <ArrowRight
              size={14}
              className="transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
            />
          </Link>
        )}

        {lead.taskId && (
          <button
            type="button"
            onClick={() => openInspector({ kind: "task", id: lead.taskId! })}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-glass px-3 text-[12px] text-fg-secondary transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            data-brief-inspect={lead.taskId}
          >
            <Eye size={13} />
            Inspect
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          aria-expanded={showWhy}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-[12px] text-fg-tertiary transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          Why this?
          {showWhy ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {lead.alternatives.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAlternatives((v) => !v)}
            aria-expanded={showAlternatives}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-[12px] text-fg-tertiary transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Different move
            {showAlternatives ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      {showWhy && (
        <div className="mt-3 space-y-1.5 border-l-2 border-edge pl-3">
          {lead.reasoning.map((line, i) => (
            <p key={i} className="text-xs leading-relaxed text-fg-tertiary">
              {line}
            </p>
          ))}
        </div>
      )}

      {showAlternatives && (
        <ul className="mt-3 space-y-1">
          {lead.alternatives.map((alt) => (
            <li key={alt.href + alt.label}>
              <Link
                href={alt.href}
                className="group flex min-h-[44px] flex-col justify-center rounded-lg px-3 py-1.5 transition-colors duration-150 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                <span className="text-[13px] font-medium text-fg group-hover:text-fg">
                  {alt.label}
                </span>
                <span className="text-[11px] text-fg-tertiary">{alt.why}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
