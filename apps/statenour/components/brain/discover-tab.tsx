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
 * 2026-08-22 · THIS SURFACE WAS TELLING THREE LIES. Measured against prod:
 *
 *  1. The badge said 56 while 242 unrated rows sat in the window. The service
 *     returns `truncated` precisely so the cap is never silent, and this
 *     component ignored it. It is read now, and the count renders as `N+`.
 *  2. The subtitle said "what the nightly engines found" while 237 of the 242
 *     (97.9%) were written by scripts/restore-orphaned-memories.ts on
 *     2026-08-16 — recovered memories whose createdAt is RESTORE time, not
 *     discovery time. Those rows are now withheld by default, labelled by
 *     provenance, and counted, never deleted; the subtitle keeps its original
 *     wording ONLY while it is true, and changes when the restored rows are
 *     toggled in.
 *  3. The footer said judging "teaches the system what you already know". It
 *     did not: lib/brain/discoveries.ts:64 records that nothing consumes the
 *     `known` signal. The copy now says what is true, which is what the
 *     KIND_META provenance lines below have always done for the claims.
 *
 * The `[CRITICAL]` / `[HIGH]` tier prefix is no longer rendered. 92.5% of all
 * blind spots ever written carry one of those two tiers, so as a display label
 * it carried ~0.4 bits. It was not invented-away or recalibrated by fiat — it
 * still does real work, as the threshold in the recurrence policy that decides
 * when a suppressed spot may come back (lib/brain/blind-spot-identity.ts).
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

/**
 * Provenance of the ROW, distinct from the epistemic kind of the CLAIM above.
 * A restored row's dates describe a recovery script, not a discovery, and the
 * feed is ordered by recency — so without this the operator reads months-old
 * findings as last night's.
 */
const RESTORED_CLAIM =
  "RESTORED · recovered from a 2026-08-16 embedding rescue — its original discovery date did not survive";

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

/**
 * Drops the `[TIER]` prefix for display only — the stored content keeps it,
 * because severityRankOf() parses it and the recurrence policy depends on it.
 */
function cardText(content: string): string {
  return content.replace(/^\[[A-Z]+\]\s*/, "");
}

/** Indexed by SEVERITY_RANK (lib/brain/blind-spot-identity.ts). */
const SEVERITY_WORD = ["low", "medium", "high", "critical"];

/**
 * The tier a resurfaced card is showing NOW, read from the stored prefix that
 * cardText() hides. Falls back to a tier-free phrase rather than guessing —
 * three of the four engines write no tier at all.
 */
function currentSeverityWord(content: string): string {
  const tag = content.match(/^\[([A-Z]+)\]/)?.[1]?.toLowerCase();
  return tag && SEVERITY_WORD.includes(tag) ? tag : "a higher tier";
}

export function DiscoverTab() {
  const [showRated, setShowRated] = useState(false);
  const [showRestored, setShowRestored] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const query = trpc.brain.discoveries.useQuery(
    { limit: 12, includeRated: showRated, includeRestored: showRestored },
    { staleTime: 60_000 },
  );
  const rate = trpc.brain.rateDiscoveryCluster.useMutation();

  const judge = async (id: string, ids: string[], verdict: Verdict) => {
    setActionError(null);
    setPending(id);
    try {
      const res = await rate.mutateAsync({ ids, verdict });
      // A cluster can partially fail — the nightly consolidate cron
      // soft-deletes merged duplicates, so a sibling can vanish between render
      // and tap. Say so rather than reporting a clean sweep. The server may
      // also rate MORE rows than this card showed, having re-derived full
      // cluster membership; surface that too rather than letting the number
      // silently disagree with the "×N shown" chip.
      if (res.failed > 0) {
        setActionError(
          `Saved ${res.rated} — ${res.failed} had already been consolidated away.`,
        );
      } else if (res.rated > ids.length) {
        setActionError(
          `Saved ${res.rated}: ${res.rated - ids.length} more copies were found beyond this page.`,
        );
      }
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
  const unratedClusters = query.data?.unratedClusters ?? 0;
  const truncated = query.data?.truncated ?? false;
  const restoredHidden = query.data?.restoredHidden ?? 0;
  const suppressedSimilar = query.data?.suppressedSimilar ?? 0;

  return (
    <div className="space-y-4">
      <MasterySectionLabel
        label="Discover"
        // CARDS, not rows: one tap now clears a whole cluster, so rows would
        // overstate the work. `+` when the scan stopped early — the service
        // has always reported `truncated` and this surface used to drop it,
        // rendering 56 against a real 242.
        count={truncated ? `${unratedClusters}+` : unratedClusters}
        tone={unratedClusters > 0 ? "amber" : "default"}
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
        {showRestored
          ? "Engine findings and recovered memories together — each card says which it is."
          : "What the nightly engines found and you haven't ruled on yet."}{" "}
        These are machine inferences, not observations — each card says which kind
        it is. Identical findings are collapsed into one card, so a verdict
        applies to every copy behind it.
      </p>

      {unrated > unratedClusters && (
        <p className="text-[11px] text-fg-secondary">
          {unratedClusters}
          {truncated ? "+" : ""} question{unratedClusters === 1 ? "" : "s"} across {unrated} row
          {unrated === 1 ? "" : "s"}
          {truncated ? " — the row count is exact; the card scan stopped early, so the question count is a floor" : ""}.
        </p>
      )}

      {restoredHidden > 0 && !showRestored && (
        <button
          onClick={() => setShowRestored(true)}
          className="min-h-[48px] w-full rounded-lg border border-glass bg-white/[0.02] px-3 text-left text-[11px] text-fg-secondary transition hover:text-fg"
        >
          {/* EXACT, not a floor: restoredHidden is its own scoped SQL count and
              is unaffected by where the card scan stopped. Appending "+" here
              presented an exact 237 as a lower bound. */}
          <span className="font-mono uppercase tracking-wider">{restoredHidden} hidden</span>{" "}
          — recovered by the 2026-08-16 embedding rescue, not found by an engine. Their dates are
          restore time, so they would sort as if they were new. Tap to include them.
        </button>
      )}
      {showRestored && (
        <button
          onClick={() => setShowRestored(false)}
          className="min-h-[48px] w-full rounded-lg border border-glass bg-white/[0.02] px-3 text-left text-[11px] text-fg-secondary transition hover:text-fg"
        >
          Showing recovered memories alongside engine findings. Tap to hide them again.
        </button>
      )}

      {suppressedSimilar > 0 && (
        <p className="rounded-lg border border-glass bg-white/[0.02] px-3 py-2 text-[11px] text-fg-secondary">
          {/* The visible effect of a judgment (learning-loops wave 2026-08-28):
              an invisible suppression is indistinguishable from no effect. A
              floor when the card scan stopped early, same as the badge. */}
          <span className="font-mono uppercase tracking-wider">
            {suppressedSimilar}
            {truncated ? "+" : ""} suppressed
          </span>{" "}
          — regenerated copies of findings you already judged known or noise. Your verdicts
          keep applying to new copies automatically.
        </p>
      )}

      {actionError && <p className="text-[11px] text-amber-400">{actionError}</p>}

      {items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing new to judge"
          provenance="ZERO"
          why="This surface read successfully and the queue is genuinely empty. What it CANNOT tell you is which upstream cause produced that: every recent discovery already has a verdict, or the engines found nothing this cycle. Both are real zeros here."
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
            const copies = d.clusterIds.length;
            const history = d.verdictHistory ?? [];
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
                  {copies > 1 && (
                    // "shown", not "identical": the server re-derives full
                    // cluster membership at rate time and may reach copies this
                    // bounded scan never returned. Claiming an exact total here
                    // would be the same overstatement as the old badge.
                    <span className="rounded border border-glass px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-fg-secondary">
                      ×{copies} shown
                    </span>
                  )}
                  {d.verdict && (
                    <span className="ml-auto rounded border border-glass px-2 py-0.5 text-[10px] font-mono uppercase text-fg-secondary">
                      {d.verdict}
                    </span>
                  )}
                </div>

                <p className="text-sm leading-relaxed text-fg">{cardText(d.content)}</p>

                {history.length > 0 && !d.verdict && (
                  // A resurfaced card MUST explain itself. Re-asking a settled
                  // question without saying why is exactly the repeat alert
                  // that gets overridden 87.9% of the time (Ancker et al.).
                  <p className="rounded border border-amber-400/30 px-2 py-1 text-[10px] leading-relaxed text-amber-300">
                    You called this {history[history.length - 1].verdict}{" "}
                    {history.length === 1 ? "once" : `${history.length}×`} — it is back because
                    severity rose from {SEVERITY_WORD[history[history.length - 1].severityRank]} to{" "}
                    {currentSeverityWord(d.content)}.
                  </p>
                )}

                <p className="text-[10px] font-mono uppercase tracking-wider text-fg-secondary">
                  {meta.claim}
                </p>
                {d.provenance === "restored" && (
                  <p className="text-[10px] font-mono uppercase tracking-wider text-fg-secondary">
                    {RESTORED_CLAIM}
                  </p>
                )}

                {!d.verdict && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {VERDICTS.map((v) => (
                      <button
                        key={v.key}
                        disabled={busy}
                        onClick={() => judge(d.id, d.clusterIds, v.key)}
                        title={copies > 1 ? `${v.hint} — applies to all ${copies}` : v.hint}
                        aria-label={
                          copies > 1
                            ? `${v.label} — ${v.hint} — applies to all ${copies} copies`
                            : `${v.label} — ${v.hint}`
                        }
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
          &ldquo;Noise&rdquo; suppresses a blind spot from this feed and from Nick&apos;s system
          prompt until its severity rises. &ldquo;Worth investigating&rdquo; opens a task.
          &ldquo;Already knew&rdquo; is recorded and nothing reads it yet — it is the only
          measurement of novelty rather than accuracy, and it is measurement, not tuning, until
          something consumes it.
        </span>
      </p>
    </div>
  );
}
