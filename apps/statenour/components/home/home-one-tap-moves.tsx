"use client";

/**
 * HomeOneTapMoves · Wave AC Phase 1B · 2026-05-28.
 *
 * The action shelf · 3 cards Nick proposes the operator do right now,
 * each one tap from home. Each card pulls from existing surfaces:
 *
 *   1. TOP MISSION TASK · highest-urgency open task across all active
 *      missions · "[Start]" routes to /missions and pre-flags the row
 *   2. TOP RELATIONSHIP PICK · reads Wave AB /api/ai/relationships-pick-today ·
 *      "[Log]" routes the operator to /relationships with the pick pre-opened
 *   3. JOURNAL PROMPT · Nick's prompt for today · "[Open]" routes to /journal
 *
 * Sam-layer · the unfair advantage. Each card is a single decision the
 * operator can act on without navigating · the home page becomes a
 * daily driver, not a blank chat awaiting input.
 *
 * Telemetry instrumented (Phase 4) · each tap fires an event so the
 * prune analysis knows which cards earn their slot.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flag, MessageCircle, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMissionSurfaceTelemetry } from "@/lib/telemetry/mission-surface";

interface OneTapMove {
  kind: "mission_task" | "relationship_outreach" | "journal_prompt";
  title: string;
  rationale: string;
  cta: string;
  href: string;
}

interface HomeMovesResponse {
  moves: OneTapMove[];
  generatedAt: string;
}

const KIND_META: Record<
  OneTapMove["kind"],
  { Icon: typeof Flag; label: string; tint: string }
> = {
  mission_task: {
    Icon: Flag,
    label: "mission",
    tint: "border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] text-[var(--gold)]",
  },
  relationship_outreach: {
    Icon: MessageCircle,
    label: "outreach",
    tint: "border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-300",
  },
  journal_prompt: {
    Icon: NotebookPen,
    label: "journal",
    tint: "border-violet-500/30 bg-violet-500/[0.05] text-violet-300",
  },
};

interface HomeOneTapMovesProps {
  isNested?: boolean;
}

export function HomeOneTapMoves({ isNested = false }: HomeOneTapMovesProps) {
  const [moves, setMoves] = useState<OneTapMove[] | null>(null);
  const telemetry = useMissionSurfaceTelemetry("home");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/home-moves", {
          credentials: "include",
        });
        if (!res.ok) throw new Error("moves_failed");
        const data = (await res.json()) as HomeMovesResponse;
        if (!cancelled) setMoves(data.moves ?? []);
      } catch {
        if (!cancelled) setMoves([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (moves === null) {
    const loadingList = (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3"
          >
            <div className="flex items-start gap-3">
              <div className="h-7 w-16 shrink-0 animate-pulse rounded-md bg-[var(--bg-elevated)]" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--bg-elevated)]" />
                <div className="h-2 w-1/2 animate-pulse rounded bg-[var(--bg-elevated)]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );

    if (isNested) {
      return loadingList;
    }

    return (
      <section aria-label="one-tap moves" aria-busy="true" className="space-y-2">
        <div className="flex items-center gap-2 px-1 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          <span>one-tap moves</span>
        </div>
        {loadingList}
      </section>
    );
  }

  if (moves.length === 0) return null;

  const innerContent = (
    <div className="space-y-2">
      {moves.map((move, i) => {
        const meta = KIND_META[move.kind];
        const Icon = meta.Icon;
        return (
          <Link
            key={`${move.kind}-${i}`}
            href={move.href}
            onClick={() =>
              telemetry.event("oneTapMoveTapped", { kind: move.kind })
            }
            className={cn(
              "block rounded-lg border bg-[var(--bg-base)] p-3 transition-colors hover:bg-[var(--bg-raised)] hover:border-[var(--gold)]/40 active:scale-[0.99]",
              "border-[var(--border-default)]",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "shrink-0 inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[9px] font-mono uppercase tracking-[0.15em]",
                  meta.tint,
                )}
              >
                <Icon size={10} strokeWidth={1.75} />
                {meta.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[var(--text-primary)] leading-snug break-words">
                  {move.title}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)] leading-snug">
                  {move.rationale}
                </p>
              </div>
              <span className="shrink-0 self-center text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
                {move.cta} →
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );

  if (isNested) {
    return innerContent;
  }

  return (
    <section aria-label="one-tap moves" className="space-y-2">
      <div className="flex items-center gap-2 px-1 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        <span>one-tap moves</span>
        <span className="text-[var(--text-tertiary)]/60">·</span>
        <span className="text-[var(--gold)] tabular-nums">{moves.length}</span>
      </div>

      {innerContent}
    </section>
  );
}
