"use client";

/**
 * AnticipatedQuestionsCard · v10.0.529.35 · Arc B Feature 6
 *
 * Surfaces the operator-facing UI for the anticipated-question feed
 * pipeline shipped at v10.0.526. Every night the `anticipate` cron
 * gathers the last 7d of operator signals (chat user-turns +
 * decisions + commitments + open loops), drafts the 3 questions
 * the operator is most likely to ask tomorrow, and precomputes the
 * answers in the background. When the operator hits chat, the chat
 * route's anticipated-injection layer attaches the cached take as
 * context so Nick can answer instantly.
 *
 * What was missing · the operator-facing view of the predictions
 * themselves. The cron writes silently · without this card the
 * operator never sees what Nick thinks they'll ask. That's a
 * power-control gap (every dial exposed) AND a momentum-build gap
 * (knowing what's queued accelerates planning).
 *
 * Surface design (DFII 10):
 *   · GlassCard with gold accent · matches DecisionReplayCard +
 *     ContradictionsCard rhythm
 *   · Top-3 questions as dense single-line tap targets
 *   · Readiness chip per question · "ready" (precomputed answer
 *     warmed) vs "drafting" (cron didn't finish · falls back to
 *     fresh generation at ask-time)
 *   · Freshness chip in the header · "today" / "stale Nd"
 *   · Each tap → /chat?seed=<question> · operator can use the
 *     precomputed answer instantly · same seed pattern decision
 *     replay + contradiction surfaces use
 *   · Silent when the feed is empty (first run · cron not yet
 *     fired) · zero noise on a fresh OS
 */

import Link from "next/link";
import { Sparkles, Clock, CheckCircle, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { useUltronFetch } from "@/lib/ultron/client-cache";
import { cn } from "@/lib/utils";

interface QuestionShape {
  text: string;
  topic: string | null;
  confidence: number;
}

interface ApiShape {
  today?: {
    date: string;
    exists: boolean;
    empty: boolean;
    builtAt: string | null;
    ageHours: number | null;
    fresh: boolean;
    /**
     * v10.0.529.40 · normalized at the API · always object shape.
     * Legacy-string responses get mapped server-side.
     */
    questions: QuestionShape[];
    readiness: Array<{ ready: boolean; chars: number }>;
  };
  yesterday?: unknown;
}

const SEED_CAP = 1800;
const PREVIEW_CHARS = 140;

function trimQuestion(s: string, n = PREVIEW_CHARS): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

export function AnticipatedQuestionsCard() {
  const raw = useUltronFetch<ApiShape>("/api/system/anticipated", {
    ttlMs: 600_000, // 10 min · the feed only rotates daily, no need to poll fast
    pollMs: 600_000,
  });

  if (raw.loading && raw.data === null) {
    return <ShimmerSkeleton variant="card" className="min-h-[96px]" />;
  }

  const today = raw.data?.today;
  if (!today || !today.exists || today.empty || today.questions.length === 0) {
    // Silent on empty board · the cron hasn't fired yet OR the
    // gather step produced 0 questions (operator was quiet last 7d).
    return null;
  }

  const freshnessLabel = today.fresh
    ? "today"
    : today.ageHours != null
      ? `stale ${Math.round(today.ageHours)}h`
      : "stale";
  const freshnessTone = today.fresh
    ? "text-[var(--gold)]"
    : "text-amber-400/80";

  return (
    <GlassCard
      className="min-h-[96px] border-[var(--gold)]/25 bg-[var(--gold)]/[0.03]"
      data-testid="anticipated-questions-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          anticipated · today
          <span className="rounded-sm border border-[var(--gold)]/30 px-1 py-px text-[9px] tabular-nums text-[var(--gold)]">
            {today.questions.length} queued
          </span>
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-[0.18em] tabular-nums",
            freshnessTone,
          )}
        >
          <Clock size={9} />
          {freshnessLabel}
        </span>
      </div>

      <ul className="mt-2 space-y-1.5" aria-label="Anticipated questions for today">
        {today.questions.map((q, i) => {
          const r = today.readiness[i];
          const ready = r?.ready ?? false;
          const confidence = q.confidence;
          const confPct = Math.round(confidence * 100);
          // v529.40 · confidence color band · ≥0.7 high (gold), 0.5-0.7
          // medium (text-secondary), < 0.5 low (tertiary). Anything below
          // MIN_CONFIDENCE (0.3) was already dropped server-side.
          const confTone =
            confidence >= 0.7
              ? "text-[var(--gold)]/80"
              : confidence >= 0.5
                ? "text-[var(--text-secondary)]"
                : "text-[var(--text-tertiary)]";
          const seedHref = `/chat?seed=${encodeURIComponent(q.text.slice(0, SEED_CAP))}`;
          return (
            <li key={`${i}-${q.text.slice(0, 20)}`} className="text-[11px] leading-snug">
              <Link
                href={seedHref}
                className="-mx-1 flex items-start gap-2 px-1 py-1 rounded-sm transition-colors hover:bg-[var(--gold)]/[0.08] focus-visible:bg-[var(--gold)]/[0.08] focus-visible:outline-none"
                aria-label={`Ask: ${q.text.slice(0, 80)}`}
              >
                {/* Readiness indicator · CheckCircle when answer
                    precomputed and warm · Loader when answer wasn't
                    captured (cron ran but generation timed out · the
                    chat route will fall back to fresh generation). */}
                {ready ? (
                  <CheckCircle
                    size={11}
                    className="shrink-0 mt-[2px] text-emerald-400/80"
                    aria-label="precomputed answer ready"
                  />
                ) : (
                  <Loader2
                    size={11}
                    className="shrink-0 mt-[2px] text-[var(--text-tertiary)]"
                    aria-label="answer not precomputed · will generate fresh"
                  />
                )}
                <span className="flex-1 text-[var(--text-primary)]">
                  {trimQuestion(q.text)}
                </span>
                {/* Per-question confidence · self-rated by the predictor
                    at draft time · low picks (<0.3) already filtered
                    server-side, so this is always ≥30%. */}
                <span
                  className={cn(
                    "shrink-0 mt-[3px] text-[8.5px] font-mono tabular-nums",
                    confTone,
                  )}
                  title={`predictor self-confidence · ${confPct}%`}
                >
                  {confPct}%
                </span>
                <Sparkles
                  size={10}
                  className="shrink-0 mt-[3px] text-[var(--gold)]/50 group-hover:text-[var(--gold)]/80"
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Footer · context for the operator about WHY these · the
          inference is based on last-7d signals · this signal-
          provenance line keeps the card honest about its limitations
          and prevents the operator from over-trusting the picks. */}
      <p className="mt-2 border-t border-[var(--border-default)]/30 pt-2 text-[10px] italic text-[var(--text-tertiary)]">
        drafted from your last 7d of chat · decisions · open loops
      </p>
    </GlassCard>
  );
}
