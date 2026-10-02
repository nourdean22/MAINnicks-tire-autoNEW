"use client";

/**
 * v10.0.526 · OsDriftTile — structural drift glance.
 *
 * Tracks four count-style health metrics with a 7d-prior comparison:
 *   · routes — total app routes (a sudden jump = something landed,
 *              a sudden drop = something got deleted)
 *   · crons — declared cron count (silent crons are the actual
 *             reliability axis · captured in SystemHealthCard)
 *   · tools — registered chat tools (drift here = leakage of
 *             unused/deprecated tools)
 *   · monsters — files over the LOC threshold (default 800) ·
 *                rising monsters = refactoring debt accumulating
 *
 * Mobile: each row is one line · numbers right-aligned · trend chip
 * inline. The 4 metrics stack in a single column inside the tile
 * (not a 2x2 grid that would feel symmetric · editorial reads top-to-
 * bottom which is what reading-on-phone wants).
 *
 * Accessibility: <dl> with explicit dt/dd pairs · screen readers
 * announce "routes 142 up two from prior week" cleanly. Delta color
 * is paired with the +/- sign so it's not color-only.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { signedDelta, type OsSnapshotShape, type TileState } from "@/hooks/use-observability";
import { EmptyTile, ErrorTile } from "./cost-slo-tile";

interface Props {
  state: TileState<OsSnapshotShape>;
}

interface DriftRow {
  key: keyof NonNullable<OsSnapshotShape["now"]>;
  label: string;
  /** "more is bad" — when true, +N deltas color rose, -N color emerald. */
  moreIsBad: boolean;
}

const ROWS: DriftRow[] = [
  { key: "routes", label: "routes", moreIsBad: false },
  { key: "crons", label: "crons", moreIsBad: false },
  { key: "tools", label: "tools", moreIsBad: false },
  // monsters are pure debt — going UP is bad, DOWN is good.
  { key: "monsters", label: "monsters", moreIsBad: true },
];

export function OsDriftTile({ state }: Props) {
  if (state.kind === "loading") {
    return <ShimmerSkeleton variant="card" className="min-h-[112px]" />;
  }
  if (state.kind === "empty") {
    return <EmptyTile label="os · drift" hint="no snapshot yet" icon={<Activity size={14} />} />;
  }
  if (state.kind === "error") {
    return <ErrorTile label="os · drift" message={state.message} />;
  }

  const now = state.data.now ?? {};
  const prior = state.data.prior ?? {};
  const monsterThreshold = state.data.monsterLocThreshold ?? 800;

  return (
    <GlassCard ruled className="min-h-[112px] border-l-edge-strong">
      <div className="flex items-center justify-between mb-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          <Activity size={11} />
          os · drift
        </span>
        <span className="font-mono text-[11px] text-fg-tertiary">
          vs 7d ago
        </span>
      </div>

      <dl className="mt-1.5 space-y-1">
        {ROWS.map(({ key, label, moreIsBad }) => {
          const nowVal = now[key] ?? 0;
          const priorVal = prior[key];
          const { delta, text, direction } = signedDelta(nowVal, priorVal);

          // Color: rose if delta points in the "bad" direction, emerald
          // if it points "good" · neutral text for flat / no prior.
          const isBad =
            direction === "flat"
              ? false
              : moreIsBad
                ? direction === "up"
                : false; // for routes/crons/tools we don't auto-rose — just show the number
          const isGood =
            direction === "flat"
              ? false
              : moreIsBad
                ? direction === "down"
                : false;

          const deltaColor = isBad
            ? "text-rose-300"
            : isGood
              ? "text-emerald-300"
              : "text-fg-tertiary";

          // Only show delta chip when we actually have a prior value to
          // compare against — without a baseline a "+5" would be misleading.
          const showDelta = priorVal !== undefined && delta !== 0;

          return (
            <div
              key={key}
              className="flex items-baseline justify-between gap-2 text-[11px] font-mono"
            >
              <dt className="text-fg-secondary tracking-wide">{label}</dt>
              <dd className="inline-flex items-baseline gap-2">
                <span className="tabular-nums text-fg">{nowVal}</span>
                {showDelta ? (
                  <span
                    className={cn("tabular-nums text-[11px]", deltaColor)}
                    aria-label={`delta ${text}`}
                  >
                    {text}
                  </span>
                ) : (
                  <span className="text-[11px] text-fg-tertiary/40">·</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="mt-1.5 font-mono text-[11px] text-fg-tertiary">
        monster &gt; {monsterThreshold} LOC
      </p>
    </GlassCard>
  );
}
