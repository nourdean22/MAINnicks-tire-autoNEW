"use client";

/**
 * v10.0.526 · CostSloTile — today's AI spend vs daily budget.
 *
 * Renders one of the four observability tiles on the Ultron home page.
 * Headline = today's USD burn · subhead = budget cap + forecast EOD ·
 * sparkline = trailing 7d daily totals · color band keys to burn-rate vs
 * cap (green < 60% · amber 60-90% · red > 90% · gold ghost when no cap).
 *
 * Click expands an inline drilldown listing the top 3 costliest
 * conversations. We do NOT pop a modal — the operator-mode rule is one
 * tap = one piece of context, no overlays.
 *
 * Accessibility (fixing-accessibility skill):
 *   · The tile itself is a <button> when clickable → keyboard-reachable
 *     by Tab, fires on Space/Enter naturally, focus-visible respected
 *     by the v526 global focus rule.
 *   · Sparkline is decorative (the headline numbers carry the meaning),
 *     so it's aria-hidden — screen readers get the digits, not a SVG path.
 *   · Color is supplementary to the textual delta; never the only carrier.
 */

import { useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { DollarSign, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUsd, type CostSloShape, type TileState } from "@/hooks/use-observability";

interface Props {
  state: TileState<CostSloShape>;
}

export function CostSloTile({ state }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (state.kind === "loading") {
    return (
      <ShimmerSkeleton
        variant="card"
        className="min-h-[112px]"
      />
    );
  }

  if (state.kind === "empty") {
    return <EmptyTile label="cost / day" hint="no spend recorded yet" icon={<DollarSign size={14} />} />;
  }

  if (state.kind === "error") {
    return <ErrorTile label="cost / day" message={state.message} />;
  }

  const { data } = state;
  const burn = data.burnUsdToday ?? 0;
  const cap = data.dailyBudgetUsd ?? 0;
  const utilization = cap > 0 ? burn / cap : null;
  const forecast = data.forecastUsdEod ?? burn;
  const top = data.topConversations ?? [];

  // Color band — only kicks in when there IS a cap; without a cap the
  // tile stays neutral-gold (no false-alarm red on uncapped accounts).
  const tier: "neutral" | "green" | "amber" | "red" =
    utilization === null
      ? "neutral"
      : utilization >= 0.9
        ? "red"
        : utilization >= 0.6
          ? "amber"
          : "green";

  const tierBorder = {
    neutral: "border-l-edge-strong",
    green: "border-l-emerald-400/70",
    amber: "border-l-amber-400",
    red: "border-l-rose-400",
  }[tier];

  const tierText = {
    neutral: "text-fg-tertiary",
    green: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-rose-300",
  }[tier];

  const sparkColor = {
    neutral: "var(--text-tertiary)",
    green: "rgb(110 231 183)",
    amber: "rgb(252 211 77)",
    red: "rgb(253 164 175)",
  }[tier];

  const handleClick = top.length > 0 ? () => setExpanded((x) => !x) : undefined;

  // When there's a drilldown, the tile is an explicit <button> (real
  // button semantics · keyboard-operable · focus-visible). With no
  // conversations to expand it stays a plain, non-interactive card.
  const cardProps = handleClick
    ? ({
        as: "button" as const,
        onClick: handleClick,
        ariaLabel: `Cost today ${formatUsd(burn)}. ${expanded ? "Collapse" : "Expand"} top ${top.length} costliest ${top.length === 1 ? "conversation" : "conversations"}.`,
      } as const)
    : {};

  return (
    <GlassCard ruled
      className={cn("relative w-full text-left", tierBorder, "min-h-[112px]")}
      {...cardProps}
    >
      {/* Header strip · label + freshness/tier dot · matches the
          existing tile vocabulary (mono eyebrow). */}
      <div className="flex items-center justify-between mb-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          <DollarSign size={11} />
          cost · today
        </span>
        {utilization !== null && (
          <span className={cn("font-mono text-[11px] tabular-nums", tierText)}>
            {Math.round(utilization * 100)}% of cap
          </span>
        )}
      </div>

      {/* Big number — burn USD · forecast inline as smaller meta. */}
      <div className="flex items-baseline gap-2">
        <span className="stat-number text-[26px] leading-none text-fg">
          {formatUsd(burn)}
        </span>
        {cap > 0 && (
          <span className="font-mono text-[11px] text-fg-tertiary tabular-nums">
            / {formatUsd(cap)}
          </span>
        )}
      </div>
      <p className="mt-1 font-mono text-[11px] text-fg-secondary">
        forecast EOD <span className="text-fg tabular-nums">{formatUsd(forecast)}</span>
      </p>

      {/* Sparkline — 7d daily burn series · decorative, hidden from a11y tree. */}
      {(data.burn7d?.length ?? 0) >= 2 && (
        <div className="mt-2" aria-hidden>
          <Sparkline data={data.burn7d!} width={140} height={20} color={sparkColor} showDot animate={false} />
        </div>
      )}

      {/* Drilldown trigger — only when there are conversations to show. */}
      {top.length > 0 && (
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-fg-tertiary">
          <span>{top.length} top {top.length === 1 ? "convo" : "convos"}</span>
          <ChevronRight
            size={12}
            className={cn("transition-transform", expanded && "rotate-90")}
          />
        </div>
      )}

      {/* Expanded drilldown — inline list, no modal. */}
      {expanded && top.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-edge-subtle pt-2">
          {top.slice(0, 3).map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 font-mono text-[11px]"
            >
              <span className="truncate text-fg-secondary" title={c.label}>
                {c.label}
              </span>
              <span className="shrink-0 tabular-nums text-fg">
                {formatUsd(c.usd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

// ── Shared low-key empty/error states (kept in this file because all 4
//    tiles import them; pulled into separate files only if they outgrow
//    ~6 LOC apiece, which would be premature optimization · YAGNI). ──

export function EmptyTile({
  label,
  hint,
  icon,
}: {
  label: string;
  hint: string;
  icon?: React.ReactNode;
}) {
  return (
    <GlassCard ruled className="min-h-[112px] border-l-edge-strong">
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
        {icon}
        {label}
      </div>
      <p className="mt-3 text-[11px] text-fg-tertiary leading-snug">
        {hint}
      </p>
      <p className="mt-2 font-mono text-[11px] text-fg-tertiary">
        endpoint quiet · check back after first run
      </p>
    </GlassCard>
  );
}

export function ErrorTile({ label, message }: { label: string; message: string }) {
  return (
    <GlassCard ruled className="min-h-[112px] border-rose-500/30 bg-rose-500/5">
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-rose-300">
        <AlertTriangle size={11} />
        {label} · failed
      </div>
      <p className="mt-2 break-words font-mono text-[11px] text-rose-300/70">
        {message.slice(0, 140)}
      </p>
    </GlassCard>
  );
}
