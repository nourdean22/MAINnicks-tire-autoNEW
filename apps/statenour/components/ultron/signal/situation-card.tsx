"use client";

/**
 * SITUATION CARD — the ONE card that replaces the 7-card stack on HQ.
 *
 * Before: RuminationCard + TomorrowNoteCard + ReflectNudge +
 * MemoryCalibrationCard + BrainCarousel + BetDesk + NarratorStrip
 * all competed for attention and told Nour the same "you're slipping"
 * story in 5 different voices with 3 STARTs and 2 dismiss buttons.
 *
 * After: one card reads /api/ultron/situation (the synthesized
 * narrative) and shows:
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │  [severity dot] HEADLINE (one line)        [tap ↗] │
 *   │  body (one line, optional)                         │
 *   │  [primary action button, if any]                   │
 *   │ ─────────────────────────────────────────────────  │
 *   │  • watch 3  • bets 45%  • re-rule 2  • pinned 4/5  │
 *   │  [+ expand ↓]   [overnight: 3 beliefs refreshed]   │
 *   └────────────────────────────────────────────────────┘
 *
 * Expand → shows secondary candidates + auto-resolved notes
 * underneath. Default: collapsed.
 *
 * Visual language:
 *   • Severity critical → red ring + pulse
 *   • high → amber ring
 *   • medium → gold ring
 *   • low → zinc ring
 *   • win → emerald ring
 *
 * No dismiss — if Nour doesn't like the pick, next poll (120s) will
 * re-rank. If the pick is wrong, expand → pick a secondary.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  Flame,
  Scale,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { trpc } from "@/lib/trpc/client";
import type {
  SituationPayload,
  SituationCandidate,
  SituationSeverity,
  SituationSource,
} from "@/lib/ultron/situation-synthesizer";

// Map severity → visual tokens
const SEV_RING: Record<SituationSeverity, string> = {
  critical: "border-red-500/50 bg-red-500/[0.04] shadow-[0_0_20px_rgba(239,68,68,0.08)]",
  high: "border-amber-500/50 bg-amber-500/[0.04]",
  medium: "border-[var(--gold)]/45 bg-[var(--gold)]/[0.04]",
  low: "border-[var(--border-hover)]/60 bg-[var(--bg-raised)]",
  win: "border-emerald-500/45 bg-emerald-500/[0.04]",
};

const SEV_DOT: Record<SituationSeverity, string> = {
  critical: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]",
  high: "bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.5)]",
  medium: "bg-[var(--gold)]",
  low: "bg-[var(--text-tertiary)]",
  win: "bg-emerald-400",
};

const SEV_TEXT: Record<SituationSeverity, string> = {
  critical: "text-red-400",
  high: "text-amber-400",
  medium: "text-[var(--gold)]",
  low: "text-[var(--text-secondary)]",
  win: "text-emerald-400",
};

const SOURCE_ICON: Record<SituationSource, typeof Zap> = {
  blind_spot: AlertTriangle,
  bet: Target,
  rumination: Shield,
  narrator: Shield,
  calibration: Sparkles,
  pin_hygiene: Sparkles,
  reflection: Eye,
  wisdom: Sparkles,
  ghost: Flame,
  momentum: TrendingUp,
  // May 02 · v10.0.147 · Trending icon for forecasting digest (it's
  // about the prediction-line trending up/down) and Sparkles for the
  // brain-growth pulse to mirror calibration/wisdom's "learning"
  // visual family.
  forecast: TrendingUp,
  brain_growth: Sparkles,
  // v10.0.529.31 · Arc B Phase 4 · Scale icon matches the
  // ContradictionsCard's resolve toggle + the TodayPulseStrip
  // POSITIONS chip · same icon across all 4 surfaces (card · chip ·
  // ticker · situation) so the operator's recognition transfers
  // without re-learning per-surface vocabulary.
  contradiction: Scale,
  // v10.0.529.32 · Arc B F4 · Compass for persona-drift · signals
  // "off the heading" · distinct from contradiction (Scale = weighing
  // two positions). Drift = directional misalignment vs identity spec.
  persona_drift: Compass,
};

const MONITOR_TONE: Record<"win" | "neutral" | "watch" | "warn" | "alert", string> = {
  win: "text-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.4)]",
  neutral: "text-[var(--text-tertiary)]",
  watch: "text-[var(--gold)] shadow-[0_0_4px_rgba(253,185,19,0.3)]",
  warn: "text-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.4)]",
  alert: "text-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]",
};

interface SituationCardProps {
  /** Optional fallback when the fetch hasn't completed yet */
  initial?: SituationPayload | null;
}

export function SituationCard({ initial = null }: SituationCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Phase B.6a (2026-05-22) · migrated off `authedFetch` onto
  // `trpc.operator.situation`. React Query's refetchInterval replaces
  // the manual setInterval (120s poll preserved). The `initial` prop
  // seeds React Query's cache via `initialData` so the card renders
  // server-provided state immediately without a loading flash. The
  // FreshnessChip's onReload now calls `refetch()`. `error` mirrors
  // the legacy string-message state via React Query's error object.
  const {
    data: payload = null,
    isLoading,
    error: queryError,
    refetch,
  } = trpc.operator.situation.useQuery(undefined, {
    refetchInterval: 120_000,
    ...(initial ? { initialData: initial } : {}),
  });
  const loading = isLoading;
  const error = queryError ? queryError.message : null;
  const load = () => {
    void refetch();
  };

  const hasStory = useMemo(
    () =>
      !!payload &&
      (!!payload.primary ||
        payload.secondaries.length > 0 ||
        payload.autoResolved.length > 0),
    [payload]
  );

  // Pure-render fallback skeleton
  if (loading && !payload) {
    return (
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-4 animate-pulse">
        <div className="h-3 w-24 rounded bg-[var(--bg-elevated)] mb-2" />
        <div className="h-4 w-3/4 rounded bg-[var(--bg-elevated)] mb-1.5" />
        <div className="h-3 w-1/2 rounded bg-[var(--bg-elevated)]" />
      </section>
    );
  }

  if (!hasStory || !payload) {
    // Clean-state fallback — still show monitors so the surface
    // carries signal even when there's nothing critical.
    return (
      <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.03] p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn("w-1.5 h-1.5 rounded-full", SEV_DOT.win)} />
          <span className="text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-emerald-400">
            situation
          </span>
          <span className="ml-auto text-[9px] font-mono text-[var(--text-tertiary)]">
            clear
          </span>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)]">
          Nothing urgent in the feed right now. Use the space.
        </p>
        {payload?.monitors && payload.monitors.length > 0 && (
          <MonitorStrip monitors={payload.monitors} />
        )}
      </section>
    );
  }

  const { primary, secondaries, autoResolved, monitors, counts, noiseReduced } = payload;
  const hasExpandable = secondaries.length > 0 || autoResolved.length > 0;

  return (
    <section
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-all",
        primary ? SEV_RING[primary.severity] : SEV_RING.low
      )}
    >
      {/* Header strip */}
      <div className="flex items-center gap-2">
        {primary && (
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              SEV_DOT[primary.severity],
              primary.severity === "critical" && "animate-pulse"
            )}
          />
        )}
        <span className="text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--text-primary)]">
          situation
        </span>
        {primary && (
          <span
            className={cn(
              "text-[9px] font-mono uppercase tracking-wider",
              SEV_TEXT[primary.severity]
            )}
          >
            {primary.severity}
          </span>
        )}
        {noiseReduced > 0 && (
          <span
            className="text-[9px] font-mono text-[var(--text-tertiary)]"
            title={`${noiseReduced} redundant signals folded into this single card`}
          >
            −{noiseReduced} noise
          </span>
        )}
        {/* v11.1 · FreshnessChip — data age at a glance */}
        <div className="ml-auto">
          <FreshnessChip
            lastFetchedAt={payload.generatedAt}
            source="situation"
            compact
            onReload={() => void load()}
          />
        </div>
      </div>

      {/* v11.1 · First-time onboarding for bet/calibration concept.
          Renders ONCE per browser (persists in localStorage). Shows
          above the primary candidate whenever that candidate is a
          bet or calibration row and Nour hasn't dismissed it before. */}
      {primary && (primary.source === "bet" || primary.source === "calibration") && (
        <CalibrationOnboarding />
      )}

      {/* Primary candidate */}
      {primary && <CandidateRow candidate={primary} primary />}

      {/* Ambient monitor strip */}
      {monitors.length > 0 && <MonitorStrip monitors={monitors} />}

      {/* Auto-resolved FYI — one inline line so Nour sees what cron did */}
      {autoResolved.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)] border-t border-[var(--border-default)]/50 pt-1.5">
          <Sparkles size={9} className="text-emerald-400/60" />
          <span className="truncate">{autoResolved[0].headline}</span>
          {autoResolved.length > 1 && (
            <span className="text-[9px] font-mono">+{autoResolved.length - 1}</span>
          )}
        </div>
      )}

      {/* Expand control */}
      {hasExpandable && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1 min-h-[44px] sm:min-h-0 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)] pt-1 transition-colors"
        >
          {expanded ? (
            <>
              collapse <ChevronUp size={10} />
            </>
          ) : (
            <>
              {secondaries.length + autoResolved.length} more ·{" "}
              <ChevronDown size={10} />
            </>
          )}
        </button>
      )}

      {/* Expanded drawer */}
      {expanded && (
        <div className="space-y-2 pt-1 border-t border-[var(--border-default)]/50">
          {secondaries.map((c, i) => (
            <CandidateRow key={`sec-${i}`} candidate={c} />
          ))}
          {autoResolved.map((c, i) => (
            <CandidateRow key={`auto-${i}`} candidate={c} />
          ))}
          {/* Rolled-up counts — animated on change (SituationSynthesizer
              polls every 120s, so number shifts are real state
              changes worth a 600ms tick-up). */}
          <div className="grid grid-cols-3 gap-2 pt-1 text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
            <div>
              <span className="text-[var(--text-tertiary)]">blind:</span>{" "}
              <span className="text-[var(--text-primary)] tabular-nums">
                <AnimatedCounter value={counts.blindSpots} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">bets:</span>{" "}
              <span className="text-[var(--text-primary)] tabular-nums">
                <AnimatedCounter value={counts.activeBets} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">beliefs:</span>{" "}
              <span className="text-[var(--text-primary)] tabular-nums">
                <AnimatedCounter value={counts.agingBeliefs} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">stale pins:</span>{" "}
              <span className="text-[var(--text-primary)] tabular-nums">
                <AnimatedCounter value={counts.stalePins} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">decisions:</span>{" "}
              <span className="text-[var(--text-primary)] tabular-nums">
                <AnimatedCounter value={counts.openRuminations} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-[var(--text-tertiary)]">reflects:</span>{" "}
              <span className="text-[var(--text-primary)] tabular-nums">
                <AnimatedCounter value={counts.reflectionsToday} duration={600} />
              </span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="text-[9px] text-red-400">
          situation fetch: {error}
        </div>
      )}
    </section>
  );
}

// ─── subcomponents ───────────────────────────────────────

function CandidateRow({
  candidate,
  primary = false,
}: {
  candidate: SituationCandidate;
  primary?: boolean;
}) {
  const Icon = SOURCE_ICON[candidate.source] || Zap;
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <Icon
          size={primary ? 12 : 10}
          className={cn(
            "mt-0.5 shrink-0",
            candidate.autoResolved ? "text-emerald-400/60" : SEV_TEXT[candidate.severity]
          )}
        />
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "leading-snug text-[var(--text-primary)]",
              primary ? "text-[13px] font-medium" : "text-[11.5px]"
            )}
          >
            {candidate.headline}
          </p>
          {candidate.body && (
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] leading-snug line-clamp-2">
              {candidate.body}
            </p>
          )}
        </div>
      </div>
      {candidate.actionLabel && candidate.action?.kind === "navigate" && (
        <Link
          href={candidate.action.href}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all",
            "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)]",
            "hover:border-[var(--gold)]/60 hover:bg-[var(--gold)]/20"
          )}
        >
          {candidate.actionLabel}
          <span className="text-[9px]">↗</span>
        </Link>
      )}
    </div>
  );
}

function MonitorStrip({
  monitors,
}: {
  monitors: SituationPayload["monitors"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono uppercase tracking-wider border-t border-[var(--border-default)]/50 pt-1.5">
      {monitors.map((m) => {
        const content = (
          <>
            <span
              className={cn(
                "w-1 h-1 rounded-full",
                MONITOR_TONE[m.tone].split(" ")[0].replace("text-", "bg-")
              )}
            />
            <span className="text-[var(--text-tertiary)]">{m.label}</span>
            <span className={cn(MONITOR_TONE[m.tone].split(" ")[0])}>{m.value}</span>
          </>
        );
        return m.href ? (
          <Link
            key={m.id}
            href={m.href}
            className="flex items-center gap-1 hover:opacity-80 transition-opacity"
          >
            {content}
          </Link>
        ) : (
          <div key={m.id} className="flex items-center gap-1">
            {content}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// v11.1 · CalibrationOnboarding
// First-time explainer for bet/prediction cards. Persists dismiss
// state in localStorage so Nour only sees it once. Renders a compact
// gold-tinted strip above a bet row with the "what's a bet · how to
// grade it · why it matters" copy.
// ─────────────────────────────────────────────────────────────

function CalibrationOnboarding() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("nour:calibration-explained") === "1";
    } catch {
      return true;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem("nour:calibration-explained", "1");
    } catch {
      // swallow — localStorage unavailable is not critical
    }
  };

  return (
    <div className="rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/5 px-2.5 py-2 flex items-start gap-2">
      <Sparkles size={12} className="text-[var(--gold)] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-[10.5px] leading-relaxed">
        <p className="font-bold text-[var(--gold)] tracking-wide mb-0.5">
          What&apos;s a bet?
        </p>
        <p className="text-[var(--text-secondary)]">
          Nick predicts outcomes based on your patterns. When it resolves,
          <span className="text-[var(--gold)] font-medium"> grade it</span>{" "}
          — right or wrong.
          After ~10 grades, Nick has a calibration score and starts
          adjusting confidence to match reality.
        </p>
        <p className="text-[9px] text-[var(--text-tertiary)] mt-1 font-mono">
          Higher calibration → Nick&apos;s data points are weightier in decisions.
        </p>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss explainer"
        className="shrink-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 w-5 h-5 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]"
      >
        <X size={10} />
      </button>
    </div>
  );
}
