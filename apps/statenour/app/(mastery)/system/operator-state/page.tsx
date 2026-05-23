"use client";

/**
 * /system/operator-state · task #22 step 5.4 (2026-05-23).
 *
 * Diagnostic surface for the explicit operator-state model. The model
 * itself is a LeCun-lens consolidation: instead of letting Nick infer
 * the operator's state from chat text (autoregressive · unreliable ·
 * the failure mode LeCun keeps naming), we compute a deterministic
 * 5-dimensional snapshot from observed TaskEvent signals.
 *
 * The 5 dimensions:
 *   · focus     · how completion-leaning the last 24h has been
 *   · capacity  · how much headroom is left vs the operator's baseline
 *   · drift     · how many open DOING tasks vs recent completions
 *   · momentum  · 7d completions slope (rising / flat / falling)
 *   · mood      · qualitative tag derived from the four above
 *
 * What this page shows:
 *   · Mood chip + 4 numeric dimensions (with confidence indicator)
 *   · The exact system-prompt block Nick WOULD see if we wired this
 *     in (helps the operator reason about the consolidation BEFORE
 *     opting any AI surface into it)
 *   · Signal breakdown (raw counts behind each dimension) for trust
 *
 * What this page does NOT do · this slice:
 *   · Does not modify Nick's chat path (off-limits per directive)
 *   · Does not auto-trigger any side effects
 *   · Read-only telemetry · diagnostic only
 *
 * Owner-gated · activity counts aren't sensitive but the policy is
 * "operator surfaces are gated" so we ride that.
 */

import Link from "next/link";
import { StandardPage } from "@/components/layout/standard-page";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Brain, ChevronLeft, Gauge, Sparkles, Zap } from "lucide-react";

type Mood = "energized" | "neutral" | "depleted" | "scattered";

// 2026-05-23 · mood → tone mapping · editorial palette, no purple
// gradients · matches the existing /system/* per-state chip system.
const MOOD_TONE: Record<Mood, string> = {
  energized:
    "border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-300",
  neutral:
    "border-[var(--border-default)] bg-[var(--bg-base)]/40 text-[var(--text-secondary)]",
  depleted: "border-rose-500/30 bg-rose-500/[0.08] text-rose-300",
  scattered: "border-amber-500/30 bg-amber-500/[0.05] text-amber-300",
};

const MOOD_BLURB: Record<Mood, string> = {
  energized:
    "Completions outpacing starts · capacity above baseline · momentum rising. Nick should match the energy: short, fast, skip preamble.",
  neutral: "Default state · no extreme reading on any dimension.",
  depleted:
    "Capacity at or below baseline · operator is saturated. Nick should NOT cheerlead, NOT lecture · short replies, no list bloat.",
  scattered:
    "Drift is elevated · lots of DOING tasks lingering vs few completions. Nick should cut the list and offer ONE concrete next thing.",
};

// pct formatter · matches /system/lens-stats convention
function pct(n: number): number {
  return Math.round(n * 100);
}

export default function OperatorStatePage() {
  const { data, isLoading, error, refetch, dataUpdatedAt } =
    trpc.system.operatorState.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });

  const snapshot = data?.snapshot;
  const promptBlock = data?.promptBlock ?? "";
  const mood = (snapshot?.mood ?? "neutral") as Mood;
  const confidence = snapshot?.confidence ?? 0;
  const confLabel =
    confidence < 0.3 ? "low" : confidence < 0.7 ? "moderate" : "high";

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="Operator State"
      description={
        snapshot
          ? `${mood} · ${confLabel}-confidence · ${snapshot.signals.length} signals`
          : isLoading
            ? "loading…"
            : "no data"
      }
      width="2xl"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={
              snapshot?.ranAt ??
              (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined)
            }
            source="db · TaskEvent + Task counts"
            onReload={() => void refetch()}
          />
          <Link
            href="/system"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft size={12} aria-hidden /> back
          </Link>
        </div>
      }
    >
      {error ? (
        <GlassCard className="p-6">
          <div className="text-sm text-rose-300">
            failed to load · {error.message}
          </div>
        </GlassCard>
      ) : null}

      {/* Mood chip + lead blurb */}
      <GlassCard className="p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border",
              MOOD_TONE[mood],
            )}
          >
            <Brain size={20} aria-hidden />
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
                  MOOD_TONE[mood],
                )}
              >
                {mood}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                · {confLabel} confidence
                {snapshot ? (
                  <>
                    {" "}
                    · <AnimatedCounter value={pct(confidence)} />%
                  </>
                ) : null}
              </span>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              {MOOD_BLURB[mood]}
            </p>
          </div>
        </div>
      </GlassCard>

      {/* The 4 numeric dimensions */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              focus
            </div>
            <Sparkles
              size={12}
              className="text-[var(--text-tertiary)]"
              aria-hidden
            />
          </div>
          <div className="mt-2 font-mono text-2xl tabular-nums text-[var(--text-primary)]">
            <AnimatedCounter value={pct(snapshot?.focus ?? 0.5)} />
            <span className="text-sm text-[var(--text-tertiary)]">%</span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
            completion rate · 24h
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              capacity
            </div>
            <Gauge
              size={12}
              className="text-[var(--text-tertiary)]"
              aria-hidden
            />
          </div>
          <div className="mt-2 font-mono text-2xl tabular-nums text-[var(--text-primary)]">
            <AnimatedCounter value={pct(snapshot?.capacity ?? 0.5)} />
            <span className="text-sm text-[var(--text-tertiary)]">%</span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
            headroom vs baseline
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              drift
            </div>
            <Zap
              size={12}
              className="text-[var(--text-tertiary)]"
              aria-hidden
            />
          </div>
          <div className="mt-2 font-mono text-2xl tabular-nums text-[var(--text-primary)]">
            <AnimatedCounter value={pct(snapshot?.drift ?? 0)} />
            <span className="text-sm text-[var(--text-tertiary)]">%</span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
            open DOING vs recent finishes
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              momentum
            </div>
            <Sparkles
              size={12}
              className="text-[var(--text-tertiary)]"
              aria-hidden
            />
          </div>
          <div className="mt-2 font-mono text-2xl tabular-nums text-[var(--text-primary)]">
            <AnimatedCounter value={pct(snapshot?.momentum ?? 0.5)} />
            <span className="text-sm text-[var(--text-tertiary)]">%</span>
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
            7d slope · normalized
          </div>
        </GlassCard>
      </div>

      {/* Signal breakdown */}
      <GlassCard className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Signals
        </h2>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          Raw counts behind the snapshot. Trust the model only as far as
          you trust these inputs.
        </p>
        {snapshot && snapshot.signals.length > 0 ? (
          <ul className="mt-4 divide-y divide-[var(--border-default)]/40">
            {snapshot.signals.map((sig, i) => (
              <li
                key={`${sig.source}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span className="text-sm text-[var(--text-secondary)]">
                  {sig.source}
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    weight {sig.weight.toFixed(2)}
                  </span>
                </span>
                <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
                  {sig.value}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 text-xs text-[var(--text-tertiary)]">
            no signals · {isLoading ? "loading…" : "fresh install or DB error"}
          </div>
        )}
      </GlassCard>

      {/* The prompt block · what Nick WOULD see */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            System-prompt block
          </h2>
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            opt-in · not wired into /chat
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          The exact string Nick would receive if a surface opted into the
          consolidation. Reading this is how you decide whether opting in
          is worth it for a given surface.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-void)]/40 p-4 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
          {promptBlock || "(loading…)"}
        </pre>
      </GlassCard>

      {/* Footnote · LeCun-lens reminder */}
      <p className="text-[11px] text-[var(--text-tertiary)]">
        LeCun-lens consolidation · explicit world-model state replaces
        autoregressive inference. Deterministic from TaskEvent +
        Task counts · degrades gracefully (0 confidence on DB error or
        cold start). To opt a surface in, import{" "}
        <code className="rounded bg-[var(--bg-void)]/40 px-1 py-0.5">
          formatOperatorStateBlock
        </code>{" "}
        from{" "}
        <code className="rounded bg-[var(--bg-void)]/40 px-1 py-0.5">
          @/lib/services/operator-state
        </code>
        .
      </p>
    </StandardPage>
  );
}
