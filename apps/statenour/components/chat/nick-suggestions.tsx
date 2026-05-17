"use client";

/**
 * NickSuggestions · Wave 29 (v10.0.529.85) · the Nick-homepage
 * proactive layer.
 *
 * Operator goal: don't go to /tasks · don't go to /goals · just chat
 * with Nick and get things done. This component reads /api/nick/suggest
 * (aggregator that cross-references mastery scores · stuck tasks ·
 * stalled goals · pattern clusters · orphan nudges · contradictions)
 * and surfaces 3-5 actionable chips ABOVE the chat composer. Each
 * chip is tappable · tapping seeds the chat input with a pre-built
 * `seedPrompt` so the operator just hits send and Nick is already
 * primed with the right intent.
 *
 * Design contract:
 *   · Tight strip · ≤ 90px tall on mobile (chips wrap, max 2 rows)
 *   · ONE accent (gold) · severity hints via border tint:
 *     · high     → amber/rose border
 *     · med      → zinc with gold hover
 *     · low      → muted border
 *   · Self-hides when no suggestions available (clean morning)
 *   · 60s polling + onDataChanged refresh for tasks/goals/brain
 *   · Each chip carries an aria-label that announces both label
 *     AND the seed-prompt so screen readers know what tapping will do
 *
 * Skills applied:
 *   · ux-flow (proactive · context-before-action · matches the
 *     "Nick has full control" intent)
 *   · prompt-engineering (seedPrompts are operator-grade · plain
 *     English · ask for action not info)
 *   · frontend-design (DFII ≥ 8 · gold accent · ONE direction)
 *   · fixing-accessibility (focus-visible · keyboard-navigable ·
 *     aria-label per chip)
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { onDataChanged } from "@/lib/events/data-change";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  AlertTriangle,
  Target,
  RotateCcw,
  Loader2,
  TrendingDown,
  GitBranch,
  Tag,
  Brain,
  // v10.0.529.89 · Wave 33 · icons for the 3 new proactive sources.
  NotebookPen,
  HandshakeIcon,
  Pin,
} from "lucide-react";

interface NickSuggestion {
  id: string;
  kind:
    | "weak-axis"
    | "stuck-task"
    | "overdue"
    | "stalled-goal"
    | "pattern"
    | "orphan-nudge"
    | "contradiction"
    | "drift"
    // v10.0.529.89 · Wave 33 · 3 new kinds from the expanded
    // /api/nick/suggest aggregator. Each has its own icon + tone.
    | "unresolved-reflection"
    | "broken-promise"
    | "stale-pin";
  severity: "high" | "med" | "low";
  label: string;
  seedPrompt: string;
  actionHint?: string;
}

interface NickSuggestionsProps {
  /** Callback when the operator taps a chip · seeds the chat input
   *  with the pre-built seedPrompt. Caller decides whether to fire
   *  immediately or just fill the input for editing.
   *
   *  v10.0.529.92 · Wave 36 · OPTIONAL · when not provided the
   *  component navigates to `/chat?q=<encoded>&suggKind=X&suggId=Y`
   *  so the same chip strip works on any surface that doesn't have
   *  a composer mounted (e.g. /brain).
   */
  onSeed?: (prompt: string, meta?: { kind: string; id: string }) => void;
}

const KIND_META: Record<
  NickSuggestion["kind"],
  { icon: typeof Sparkles; tone: string }
> = {
  "weak-axis": { icon: Target, tone: "amber" },
  "stuck-task": { icon: RotateCcw, tone: "rose" },
  overdue: { icon: AlertTriangle, tone: "rose" },
  "stalled-goal": { icon: TrendingDown, tone: "amber" },
  pattern: { icon: GitBranch, tone: "sky" },
  "orphan-nudge": { icon: Tag, tone: "zinc" },
  contradiction: { icon: Brain, tone: "violet" },
  drift: { icon: AlertTriangle, tone: "amber" },
  // v10.0.529.89 · Wave 33.
  "unresolved-reflection": { icon: NotebookPen, tone: "violet" },
  "broken-promise": { icon: HandshakeIcon, tone: "rose" },
  "stale-pin": { icon: Pin, tone: "zinc" },
};

const SEVERITY_RING: Record<NickSuggestion["severity"], string> = {
  high: "border-rose-500/40 bg-rose-500/[0.04] hover:border-rose-500/60 hover:bg-rose-500/[0.08]",
  med: "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] hover:border-[var(--gold)]/40 hover:bg-[var(--gold)]/[0.06]",
  low: "border-[var(--border-default)]/60 bg-transparent hover:border-[var(--gold)]/30",
};

export function NickSuggestions({ onSeed }: NickSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<NickSuggestion[] | null>(null);
  const [error, setError] = useState(false);
  const router = useRouter();

  // v10.0.529.92 · Wave 36 · standalone fallback when no onSeed
  // provided. Navigates to /chat?q=<prompt>&suggKind=X&suggId=Y so
  // the chat page can hydrate input + transportBodyRef anchors on
  // mount via the existing useChatDeepLink hook. Same chip strip
  // works on /brain · /journal · anywhere without a composer.
  const handleSeed = useCallback(
    (prompt: string, meta?: { kind: string; id: string }) => {
      if (onSeed) {
        onSeed(prompt, meta);
        return;
      }
      const params = new URLSearchParams({ q: prompt });
      if (meta) {
        params.set("suggKind", meta.kind);
        params.set("suggId", meta.id);
      }
      router.push(`/chat?${params.toString()}`);
    },
    [onSeed, router],
  );

  const load = useCallback(async () => {
    try {
      const r = await authedFetch("/api/nick/suggest", { cache: "no-store" });
      if (!r.ok) {
        setError(true);
        return;
      }
      const body = await r.json();
      const payload = (body?.data ?? body) as { suggestions: NickSuggestion[] };
      setSuggestions(payload.suggestions ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    // v10.0.529.86 · Wave 30 · subscribe to wider domain set so
    // suggestions refresh when Nick (or any surface) writes to
    // missions / brain / commitments / score. The aggregator at
    // /api/nick/suggest reads from all of these · staying narrow
    // (tasks+goals) left chips stale after pinMemory / addCommitment.
    const off = onDataChanged(
      ["tasks", "goals", "missions", "brain", "commitments", "score"],
      () => {
        setTimeout(() => void load(), 500);
      },
    );
    return () => {
      clearInterval(id);
      off();
    };
  }, [load]);

  // Initial · before first fetch resolves, render nothing
  if (suggestions === null) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <Loader2 size={12} className="animate-spin text-[var(--text-tertiary)]" />
        <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
          nick is reading the signal
        </span>
      </div>
    );
  }

  if (error || suggestions.length === 0) return null;

  return (
    <section
      aria-label="Nick's suggestions"
      // v10.0.529.95 · Wave 39 · M3 · sm:flex-wrap so desktop keeps 2-row
      // wrap · mobile uses horizontal scroll so 5 chips don't push the
      // composer off a 667px iPhone SE viewport before keyboard opens.
      // overflow-x-auto + scrollbar-thin for the scroll affordance.
      className="flex items-center gap-1.5 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible px-3 py-2 max-w-3xl mx-auto"
    >
      <div className="inline-flex items-center gap-1 shrink-0">
        <Sparkles size={11} className="text-[var(--gold)]" />
        <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          nick suggests
        </span>
      </div>
      {suggestions.map((s) => {
        const meta = KIND_META[s.kind] ?? KIND_META["pattern"];
        const Icon = meta.icon;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => handleSeed(s.seedPrompt, { kind: s.kind, id: s.id })}
            aria-label={`${s.label} · tap to ${s.actionHint ?? "ask"}`}
            title={s.seedPrompt}
            // v10.0.529.95 · Wave 39 · C1 · 44px min tap target (iOS HIG).
            // Pre-Wave-39 chips were 24-26px tall · ~40% of sweaty-thumb
            // taps missed. This is the operator's primary chat entry
            // point · unreliable taps = unusable proactive layer.
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 min-h-[44px] transition-colors shrink-0",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]",
              SEVERITY_RING[s.severity],
            )}
          >
            <Icon
              size={11}
              className={cn(
                "shrink-0",
                meta.tone === "amber" && "text-amber-400",
                meta.tone === "rose" && "text-rose-400",
                meta.tone === "sky" && "text-sky-400",
                meta.tone === "zinc" && "text-zinc-400",
                meta.tone === "violet" && "text-violet-400",
              )}
            />
            <span className="text-[10px] font-mono text-[var(--text-primary)] max-w-[280px] truncate">
              {s.label}
            </span>
          </button>
        );
      })}
    </section>
  );
}
