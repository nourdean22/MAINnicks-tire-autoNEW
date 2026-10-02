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
  critical: "border-red-500/50 bg-red-500/[0.04]",
  high: "border-amber-500/50 bg-amber-500/[0.04]",
  medium: "border-sky-500/40 bg-sky-500/[0.04]",
  low: "border-edge-default bg-content",
  win: "border-emerald-500/45 bg-emerald-500/[0.04]",
};

const SEV_DOT: Record<SituationSeverity, string> = {
  critical: "bg-red-500",
  high: "bg-amber-400",
  medium: "bg-sky-400",
  low: "bg-fg-tertiary",
  win: "bg-emerald-400",
};

const SEV_TEXT: Record<SituationSeverity, string> = {
  critical: "text-red-400",
  high: "text-amber-400",
  medium: "text-sky-300",
  low: "text-fg-secondary",
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
  win: "text-emerald-400",
  neutral: "text-fg-tertiary",
  watch: "text-sky-300",
  warn: "text-amber-400",
  alert: "text-red-400",
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
      <section className="rounded-surface border border-edge-subtle bg-content p-4 animate-pulse">
        <div className="h-3 w-24 rounded-micro bg-surface-raised mb-2" />
        <div className="h-4 w-3/4 rounded-micro bg-surface-raised mb-1.5" />
        <div className="h-3 w-1/2 rounded-micro bg-surface-raised" />
      </section>
    );
  }

  // Unknown-is-not-clear (2026-08-19): a failed fetch used to fall
  // through to the emerald "clear" branch below — a dead feed rendered
  // as a healthy operator. The old error line lived inside the
  // hasStory && payload branch and was unreachable on exactly the
  // failures it existed for.
  if (error && !payload) {
    return (
      <section className="rounded-surface border border-rose-500/30 bg-rose-500/[0.04] p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-rose-400">
            situation
          </span>
          <span className="ml-auto font-mono text-[11px] text-fg-tertiary">
            unreadable
          </span>
        </div>
        <p className="text-[12px] text-fg-secondary">
          The signal feed could not be read — state is UNKNOWN, not clear.
        </p>
        <button
          type="button"
          onClick={load}
          className="mt-2 text-[13px] font-medium text-rose-300/80 hover:text-rose-200 min-h-[44px] min-w-[44px] text-left"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!hasStory || !payload) {
    // Clean-state fallback — still show monitors so the surface
    // carries signal even when there's nothing critical.
    return (
      <section className="rounded-surface border border-emerald-500/30 bg-emerald-500/[0.03] p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn("w-1.5 h-1.5 rounded-full", SEV_DOT.win)} />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-emerald-400">
            situation
          </span>
          <span className="ml-auto font-mono text-[11px] text-fg-tertiary">
            clear
          </span>
        </div>
        <p className="text-[12px] text-fg-secondary">
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
        "rounded-surface border p-3 space-y-2 transition-all",
        primary ? SEV_RING[primary.severity] : SEV_RING.low
      )}
    >
      {/* Header strip */}
      <div className="flex items-center gap-2">
        {primary && (
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              SEV_DOT[primary.severity]
            )}
          />
        )}
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">
          situation
        </span>
        {primary && (
          <span
            className={cn(
              "font-mono text-[11px] uppercase tracking-[0.12em]",
              SEV_TEXT[primary.severity]
            )}
          >
            {primary.severity}
          </span>
        )}
        {noiseReduced > 0 && (
          <span
            className="font-mono text-[11px] text-fg-tertiary"
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
        <div className="flex items-center gap-1.5 text-[11px] text-fg-tertiary border-t border-edge-subtle pt-1.5">
          <Sparkles size={9} className="text-emerald-400/60" />
          <span className="truncate">{autoResolved[0].headline}</span>
          {autoResolved.length > 1 && (
            <span className="font-mono text-[11px]">+{autoResolved.length - 1}</span>
          )}
        </div>
      )}

      {/* Expand control */}
      {hasExpandable && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1 min-h-[44px] sm:min-h-0 text-[13px] font-medium text-fg-tertiary hover:text-fg pt-1 transition-colors"
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
        <div className="space-y-2 pt-1 border-t border-edge-subtle">
          {secondaries.map((c, i) => (
            <CandidateRow key={`sec-${i}`} candidate={c} />
          ))}
          {autoResolved.map((c, i) => (
            <CandidateRow key={`auto-${i}`} candidate={c} />
          ))}
          {/* Rolled-up counts — animated on change (SituationSynthesizer
              polls every 120s, so number shifts are real state
              changes worth a 600ms tick-up). */}
          <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            <div>
              <span className="text-fg-tertiary">blind:</span>{" "}
              <span className="text-fg tabular-nums">
                <AnimatedCounter value={counts.blindSpots} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-fg-tertiary">bets:</span>{" "}
              <span className="text-fg tabular-nums">
                <AnimatedCounter value={counts.activeBets} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-fg-tertiary">beliefs:</span>{" "}
              <span className="text-fg tabular-nums">
                <AnimatedCounter value={counts.agingBeliefs} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-fg-tertiary">stale pins:</span>{" "}
              <span className="text-fg tabular-nums">
                <AnimatedCounter value={counts.stalePins} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-fg-tertiary">decisions:</span>{" "}
              <span className="text-fg tabular-nums">
                <AnimatedCounter value={counts.openRuminations} duration={600} />
              </span>
            </div>
            <div>
              <span className="text-fg-tertiary">reflects:</span>{" "}
              <span className="text-fg tabular-nums">
                <AnimatedCounter value={counts.reflectionsToday} duration={600} />
              </span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="text-[11px] text-red-400">
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
              "leading-snug text-fg",
              primary ? "text-[13px] font-medium" : "text-[11.5px]"
            )}
          >
            {candidate.headline}
          </p>
          {candidate.body && (
            <p className="mt-0.5 text-[11px] text-fg-secondary leading-snug line-clamp-2">
              {candidate.body}
            </p>
          )}
        </div>
      </div>
      {candidate.actionLabel && candidate.action?.kind === "navigate" && (
        <Link
          href={candidate.action.href}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-control border border-edge-default bg-content text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
          )}
        >
          {candidate.actionLabel}
          <span className="text-[11px]">↗</span>
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] border-t border-edge-subtle pt-1.5">
      {monitors.map((m) => {
        const content = (
          <>
            <span
              className={cn(
                "w-1 h-1 rounded-full",
                MONITOR_TONE[m.tone].split(" ")[0].replace("text-", "bg-")
              )}
            />
            <span className="text-fg-tertiary">{m.label}</span>
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
    <div className="rounded-control border border-edge-default bg-surface-raised px-2.5 py-2 flex items-start gap-2">
      <Sparkles size={12} className="text-fg-tertiary mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-[11px] leading-relaxed">
        <p className="font-semibold text-fg mb-0.5">
          What&apos;s a bet?
        </p>
        <p className="text-fg-secondary">
          Nick predicts outcomes based on your patterns. When it resolves,
          <span className="text-fg font-medium"> grade it</span>{" "}
          — right or wrong.
          After ~10 grades, Nick has a calibration score and starts
          adjusting confidence to match reality.
        </p>
        <p className="font-mono text-[11px] text-fg-tertiary mt-1">
          Higher calibration → Nick&apos;s data points are weightier in decisions.
        </p>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss explainer"
        className="shrink-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 w-5 h-5 rounded-control flex items-center justify-center text-fg-tertiary hover:text-fg hover:bg-surface-hover"
      >
        <X size={10} />
      </button>
    </div>
  );
}
