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
 *
 * 2026-09-16 · Visible Transformation: THE MOVE. One gold rule down the left,
 * the headline as a real eyebrow h2, the body at reading size, one primary
 * action in display type. No card.
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

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

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
      <section aria-label="the brief" className="mt-10 space-y-3 border-l-2 border-edge pl-5 sm:pl-6" aria-busy>
        <div className="h-3 w-24 animate-pulse rounded bg-raised" />
        <div className="h-7 w-3/4 animate-pulse rounded bg-raised" />
        <div className="h-4 w-full animate-pulse rounded bg-raised" />
      </section>
    );
  }
  if (!lead) return null;

  const tone = KIND_TONE[lead.kind];

  return (
    <section aria-label="the brief" className="mt-10 border-l border-edge-default pl-5 sm:pl-6">
      <div className="flex items-center gap-2">
        <span className="notch h-3" aria-hidden />
        <h2 className={cn("vt-eyebrow", tone)}>{lead.headline}</h2>
      </div>

      <p className="mt-3 max-w-[56ch] text-pretty text-lg leading-relaxed text-fg sm:text-xl">
        {lead.body}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-3">
        {lead.cta && (
          <Link
            href={lead.cta.href}
            className={cn(
              "group inline-flex min-h-[48px] items-center gap-2 rounded-control bg-accent px-5 text-[15px] font-semibold text-[var(--text-inverse)] transition-colors duration-[var(--motion-state)] hover:bg-accent-hover",
              FOCUS,
            )}
          >
            {lead.cta.label}
            <ArrowRight
              size={16}
              className="transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
            />
          </Link>
        )}

        {lead.taskId && (
          <button
            type="button"
            onClick={() => openInspector({ kind: "task", id: lead.taskId! })}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] text-fg-secondary transition-colors duration-150 hover:border-edge-strong hover:text-fg",
              FOCUS,
            )}
            data-brief-inspect={lead.taskId}
          >
            <Eye size={14} />
            Inspect
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          aria-expanded={showWhy}
          className={cn(
            "inline-flex min-h-[44px] items-center gap-1 rounded-md px-3 text-[13px] text-fg-tertiary transition-colors duration-150 hover:text-fg",
            FOCUS,
          )}
        >
          Why this?
          {showWhy ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {lead.alternatives.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAlternatives((v) => !v)}
            aria-expanded={showAlternatives}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-1 rounded-md px-3 text-[13px] text-fg-tertiary transition-colors duration-150 hover:text-fg",
              FOCUS,
            )}
          >
            Different move
            {showAlternatives ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      {showWhy && (
        <div className="mt-4 space-y-2 border-l border-edge pl-4">
          {lead.reasoning.map((line, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-fg-tertiary">
              {line}
            </p>
          ))}
        </div>
      )}

      {showAlternatives && (
        <ul className="mt-4 divide-y divide-edge border-y border-edge">
          {lead.alternatives.map((alt) => (
            <li key={alt.href + alt.label}>
              <Link
                href={alt.href}
                className={cn(
                  "group flex min-h-[52px] flex-col justify-center py-2 transition-colors duration-150 hover:text-gold",
                  FOCUS,
                )}
              >
                <span className="text-[15px] font-medium text-fg group-hover:text-gold">{alt.label}</span>
                <span className="text-[12px] text-fg-tertiary">{alt.why}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
