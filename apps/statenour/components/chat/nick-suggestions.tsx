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
import { trpc } from "@/lib/trpc/client";
import { onDataChanged } from "@/lib/events/data-change";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  AlertTriangle,
  Target,
  RotateCcw,
  TrendingDown,
  GitBranch,
  Tag,
  Brain,
  // v10.0.529.89 · Wave 33 · icons for the 3 new proactive sources.
  NotebookPen,
  HandshakeIcon,
  Pin,
  ChevronDown,
  X,
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
  // v10.0.529.96 · Wave 40 · slim mode · show ONE chip by default + "+ N more"
  // pill that expands the rest. Operator feedback: "obnoxiously big · don't
  // even think it's that smart." We keep the smart aggregator but surface
  // only the top-priority chip · the rest are 1 tap away.
  const [expanded, setExpanded] = useState(false);
  // v10.0.529.98 · suggestion-loop · client-side dismiss state. When the
  // operator clicks the X on a chip, we fire `event=dismissed` to the
  // suggestion-loop API and hide the chip locally. Server-side filtering
  // happens on the next nick.suggestions fetch · a future improve-agent
  // pass can read these dismissal signals to surface less-noisy chips.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const router = useRouter();

  // Cross-domain residuals slice (2026-05-22) · migrated off
  // `authedFetch("/api/nick/suggest")` onto `trpc.nick.suggestions`.
  // The legacy `cache: "no-store"` is preserved via `staleTime: 0`; the
  // 60s interval is React Query's `refetchInterval`. The data-change bus
  // (below) invalidates the query so suggestions refresh after a write.
  const utils = trpc.useUtils();
  const query = trpc.nick.suggestions.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Cross-domain residuals slice · the two suggestion-loop POSTs migrated
  // off `authedFetch("/api/brain/suggestion-loop")` onto
  // `trpc.brain.recordSuggestionSignal`. Fire-and-forget · never let
  // signal capture break the seed flow.
  const signalMutation = trpc.brain.recordSuggestionSignal.useMutation();

  // v10.0.529.92 · Wave 36 · standalone fallback when no onSeed
  // provided. Navigates to /chat?q=<prompt>&suggKind=X&suggId=Y so the
  // chat page prefills the composer on mount (2026-08-12: handled by
  // chat-v2's use-chat-deep-link-prefill — prefill only, never
  // auto-send; the old useChatDeepLink handler is retired). Same chip
  // strip works on /brain · /journal · anywhere without a composer.
  //
  // v10.0.529.97 · suggestion-loop · fire the "acted" supervised
  // signal before seeding the input. Fire-and-forget · don't block the
  // UI on the mutation. This closes the Ilya feedback loop · every chip
  // tap becomes a training example for improve-agent + future DPO data.
  const recordTap = useCallback(
    (meta: { kind: NickSuggestion["kind"]; id: string }) => {
      signalMutation.mutate({
        type: "action",
        suggestionId: meta.id,
        suggestionKind: meta.kind,
        event: "acted",
      });
    },
    [signalMutation],
  );

  const recordDismiss = useCallback(
    (meta: { kind: NickSuggestion["kind"]; id: string }) => {
      signalMutation.mutate({
        type: "action",
        suggestionId: meta.id,
        suggestionKind: meta.kind,
        event: "dismissed",
      });
    },
    [signalMutation],
  );

  const handleSeed = useCallback(
    (prompt: string, meta?: { kind: NickSuggestion["kind"]; id: string }) => {
      if (meta) recordTap(meta);
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
    [onSeed, router, recordTap],
  );

  useEffect(() => {
    // v10.0.529.86 · Wave 30 · subscribe to wider domain set so
    // suggestions refresh when Nick (or any surface) writes to
    // missions / brain / commitments / score. The aggregator reads from
    // all of these · staying narrow (tasks+goals) left chips stale after
    // pinMemory / addCommitment.
    const off = onDataChanged(
      ["tasks", "goals", "missions", "brain", "commitments", "score"],
      () => {
        setTimeout(() => void utils.nick.suggestions.invalidate(), 500);
      },
    );
    return () => {
      off();
    };
  }, [utils]);

  // Initial · before first fetch resolves, render nothing (silent · no shimmer
  // strip · the chip itself is the affordance). v10.0.529.96 · Wave 40 ·
  // slim mode · the proactive layer should NOT announce its own loading.
  if (query.data === undefined) {
    return null;
  }

  if (query.isError) return null;
  const suggestions = query.data.suggestions;
  if (suggestions.length === 0) return null;

  // v10.0.529.96 · Wave 40 · slim mode · ONE chip + tap-to-expand.
  // The aggregator already returns severity-sorted suggestions · the
  // first chip IS the top-priority one. Operator opens the rest with
  // a single tap on "+ N more" · most days they'll never need to.
  //
  // v10.0.529.98 · filter dismissed chips locally so the operator
  // doesn't keep seeing what they just X'd. Server-side persistence
  // happens via the suggestion-loop API · the next /api/nick/suggest
  // fetch (60s interval) may still return them until the aggregator
  // also reads dismissal signals.
  const live = suggestions.filter((s) => !dismissedIds.has(s.id));
  if (live.length === 0) return null;
  const [top, ...rest] = live;
  const visible = expanded ? live : [top];

  return (
    <section
      aria-label="Nick's suggestions"
      className="flex items-center gap-1.5 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible px-3 py-2 max-w-3xl mx-auto"
    >
      <div className="inline-flex items-center gap-1 shrink-0">
        <Sparkles size={11} className="text-[var(--gold)]" />
      </div>
      {visible.map((s) => {
        const meta = KIND_META[s.kind] ?? KIND_META["pattern"];
        const Icon = meta.icon;
        // v10.0.529.98 · two-button group · the chip body taps to seed +
        // record acted · the X dismisses + records dismissed. Wrapped in
        // a non-button div so HTML doesn't nest interactive elements.
        return (
          <div
            key={s.id}
            className={cn(
              "inline-flex items-center rounded-full border transition-colors shrink-0",
              "focus-within:outline-none focus-within:ring-1 focus-within:ring-[var(--gold)]",
              SEVERITY_RING[s.severity],
            )}
          >
            <button
              type="button"
              onClick={() => handleSeed(s.seedPrompt, { kind: s.kind, id: s.id })}
              aria-label={`${s.label} · tap to ${s.actionHint ?? "ask"}`}
              title={s.seedPrompt}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[32px] focus:outline-none"
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
              <span className="text-[10px] font-mono text-[var(--text-primary)] max-w-[240px] truncate">
                {s.label}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                recordDismiss({ kind: s.kind, id: s.id });
                setDismissedIds((prev) => {
                  const next = new Set(prev);
                  next.add(s.id);
                  return next;
                });
              }}
              aria-label={`Dismiss · ${s.label}`}
              title="Dismiss · captured as supervised signal"
              className="inline-flex items-center justify-center px-1.5 py-1.5 min-h-[32px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] focus:outline-none"
            >
              <X size={10} className="shrink-0" />
            </button>
          </div>
        );
      })}
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse suggestions" : `Show ${rest.length} more suggestions`}
          aria-expanded={expanded}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-[var(--border-default)]/60",
            "bg-transparent hover:border-[var(--gold)]/30 hover:bg-[var(--gold)]/[0.04]",
            "px-2 py-1 min-h-[32px] transition-colors shrink-0",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]",
          )}
        >
          <ChevronDown
            size={11}
            className={cn(
              "text-[var(--text-tertiary)] transition-transform",
              expanded && "rotate-180",
            )}
          />
          <span className="text-[10px] font-mono text-[var(--text-tertiary)]">
            {expanded ? "less" : `+${rest.length}`}
          </span>
        </button>
      )}
    </section>
  );
}
