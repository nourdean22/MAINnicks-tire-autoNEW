"use client";

/**
 * DiscoverTab — /brain → Discover.
 *
 * The nightly creative engines (counter-intuitive, correlation-finder,
 * blind-spot-detector, teaching-moments) have always run and always persisted.
 * Nothing read them on their own terms: their output competed in the general
 * BrainMemory pool ranked by `confidence`, which is a re-sighting count, so a
 * one-off surprising finding structurally lost to a re-observed banality.
 * This is the surface that reads them by recency instead.
 *
 * Every card states what KIND of claim it is before its content — a
 * correlation is not a cause, a blind spot is an inference, a teaching moment
 * is a reading of past data. Speculation is allowed to be aggressive here
 * precisely BECAUSE it is labelled; the boundary is what makes the freedom
 * safe.
 *
 * The three verdicts are the system's only outcome signal for creative work.
 * "Already knew" in particular is the sole measurement of the operator's
 * actual complaint, and the only evidence that could ever justify turning on
 * NICK_NOVELTY_RECALL.
 */

import { useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { Lightbulb, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";

type Verdict = "investigate" | "known" | "noise";

/**
 * What each engine's output IS, epistemically. Shown before the content so
 * the operator never has to guess whether he is reading a fact or a guess.
 */
const KIND_META: Record<
  string,
  { label: string; claim: string; tone: string }
> = {
  counter_intuitive: {
    label: "Counter-intuitive",
    claim: "INFERRED · an assumption the data appears to contradict",
    tone: "text-amber-300 border-amber-400/30",
  },
  hidden_correlation: {
    label: "Correlation",
    claim: "SPECULATIVE · co-movement only — not a demonstrated cause",
    tone: "text-sky-300 border-sky-400/30",
  },
  blind_spot: {
    label: "Blind spot",
    claim: "INFERRED · a gap derived from your own activity, not observed directly",
    tone: "text-rose-300 border-rose-400/30",
  },
  teaching_moment: {
    label: "Pattern",
    claim: "INFERRED · a reading of past events, worth checking against memory",
    tone: "text-emerald-300 border-emerald-400/30",
  },
};

const VERDICTS: Array<{ key: Verdict; label: string; hint: string }> = [
  { key: "investigate", label: "Worth investigating", hint: "useful and new" },
  { key: "known", label: "Already knew", hint: "true, but not new to me" },
  { key: "noise", label: "Noise", hint: "not useful" },
];

// Ages by lastSeen, matching the query's recency axis. Using createdAt here
// would print "45d ago" on a finding an engine refreshed last night —
// correlation-finder and teaching-moments both write stable keys, so a
// re-run reinforces the original row rather than creating a new one.
function ageLabel(iso: string | Date): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function DiscoverTab() {
  const [showRated, setShowRated] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const query = trpc.brain.discoveries.useQuery(
    { limit: 12, includeRated: showRated },
    { staleTime: 60_000 },
  );
  const rate = trpc.brain.rateDiscovery.useMutation();

  const judge = async (id: string, verdict: Verdict) => {
    setActionError(null);
    setPending(id);
    try {
      await rate.mutateAsync({ id, verdict });
      await utils.brain.discoveries.invalidate();
    } catch {
      // Honest failure, no optimistic removal — matches FollowUpsList.
      setActionError("That verdict didn't save — the card stays until the server accepts it.");
    } finally {
      setPending(null);
    }
  };

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <GlassCard className="p-4">
        <p className="text-sm text-amber-300">
          Discoveries couldn&apos;t load — state unknown, not empty.
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          The nightly engines may still have run; this surface just can&apos;t read them right now.
        </p>
      </GlassCard>
    );
  }

  const items = query.data?.items ?? [];
  const unrated = query.data?.unrated ?? 0;

  return (
    <div className="space-y-4">
      <MasterySectionLabel
        label="Discover"
        count={unrated}
        tone={unrated > 0 ? "amber" : "default"}
        action={
          <button
            onClick={() => setShowRated((v) => !v)}
            className="min-h-[48px] min-w-[48px] sm:min-h-[28px] rounded-md border border-glass px-3 text-[11px] font-mono uppercase tracking-wider text-fg-secondary transition hover:text-fg"
          >
            {showRated ? "unjudged only" : "include judged"}
          </button>
        }
      />

      <p className="text-xs text-fg-secondary">
        What the nightly engines found and you haven&apos;t ruled on yet. These are
        machine inferences, not observations — each card says which kind it is.
        Judging them is what teaches the system what you already know.
      </p>

      {actionError && <p className="text-[11px] text-amber-400">{actionError}</p>}

      {items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing new to judge"
          why="Every recent discovery has a verdict, or the engines found nothing this cycle."
          unlock="The brain-intelligence cron runs nightly — check back tomorrow, or include judged items above."
        />
      ) : (
        <div className="space-y-3">
          {items.map((d) => {
            const meta = KIND_META[d.category] ?? {
              label: d.category,
              claim: "INFERRED · machine-generated",
              tone: "text-zinc-300 border-white/10",
            };
            const busy = pending === d.id;
            return (
              <GlassCard key={d.id} className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                      meta.tone,
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[10px] font-mono text-fg-secondary">
                    {ageLabel(d.lastSeen)}
                  </span>
                  {d.verdict && (
                    <span className="ml-auto rounded border border-glass px-2 py-0.5 text-[10px] font-mono uppercase text-fg-secondary">
                      {d.verdict}
                    </span>
                  )}
                </div>

                <p className="text-sm leading-relaxed text-fg">{d.content}</p>

                <p className="text-[10px] font-mono uppercase tracking-wider text-fg-secondary">
                  {meta.claim}
                </p>

                {!d.verdict && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {VERDICTS.map((v) => (
                      <button
                        key={v.key}
                        disabled={busy}
                        onClick={() => judge(d.id, v.key)}
                        title={v.hint}
                        aria-label={`${v.label} — ${v.hint}`}
                        className={cn(
                          // 48x48 minimum, both dimensions — root AGENTS.md
                          // mandates 48x48 for the standalone iOS PWA, and a
                          // short label like "Noise" missed it on width even at
                          // min-h-[44px]. These are the primary verdict
                          // controls; a mis-tap writes the wrong signal into
                          // the ledger this feature exists to fill.
                          "min-h-[48px] min-w-[48px] rounded-lg border px-4 text-xs font-medium transition disabled:opacity-50",
                          v.key === "investigate"
                            ? "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15"
                            : "border-glass bg-white/[0.02] text-fg-secondary hover:text-fg hover:bg-white/[0.05]",
                        )}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-2 text-[10px] text-fg-secondary">
        <Lightbulb size={12} className="mt-0.5 shrink-0" />
        <span>
          Verdicts feed the outcome ledger, which is where recall-eval cases come
          from. &ldquo;Already knew&rdquo; is the most useful button here — it is the
          only thing that measures novelty rather than accuracy.
        </span>
      </p>
    </div>
  );
}
