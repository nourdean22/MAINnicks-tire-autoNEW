"use client";

/**
 * /system/calibration · Wave H · M1 (2026-05-23).
 *
 * The Closed-Loop Calibrated Brain · state-conditioned suggestion
 * hit rate. Operator's #1 LeCun-lens moat move: combine the explicit
 * world-model (Wave 5.3 operator-state) with the supervised signal
 * (Wave H upgrade to suggestion-loop) to reveal which suggestions
 * land in which states.
 *
 * Grid:
 *   rows: mood (energized · neutral · depleted · scattered)
 *   cols: suggestion kind (task · goal · sms · reflection · ...)
 *   cells: acted / total · color-graded by hit rate
 *
 * Pre-Wave-H rows show as `unstamped` count · they predate the state
 * snapshot capture and can't be classified by mood. As new rows
 * accumulate, the grid fills out.
 */

import Link from "next/link";
import { StandardPage } from "@/components/layout/standard-page";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronLeft, Grid3x3 } from "lucide-react";

type Mood = "energized" | "neutral" | "depleted" | "scattered";

const MOOD_LABEL: Record<Mood, string> = {
  energized: "energized",
  neutral: "neutral",
  depleted: "depleted",
  scattered: "scattered",
};

// Color the cell by hit rate · matches the calibration-card palette
// from /system/judge-eval. Gray = no data · rose = poor · amber =
// borderline · emerald = strong.
function cellTone(pct: number, total: number): string {
  if (total === 0 || pct < 0) {
    return "border-[var(--border-default)] bg-[var(--bg-base)]/30 text-[var(--text-tertiary)]";
  }
  if (pct >= 60) return "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300";
  if (pct >= 35) return "border-amber-500/30 bg-amber-500/[0.06] text-amber-300";
  return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
}

export default function CalibrationPage() {
  const { data, isLoading, error, refetch, dataUpdatedAt } =
    trpc.system.stateCalibration.useQuery(
      { sinceDays: 30 },
      { refetchOnWindowFocus: false },
    );

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="State Calibration"
      description={
        data
          ? `${data.totalRows} actions · ${data.unstamped} pre-Wave-H · ${data.sinceDays}d`
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
              data?.generatedAt ??
              (dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : undefined)
            }
            source="brain · suggestion_loop"
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
          <div className="text-sm text-rose-300">failed to load · {error.message}</div>
        </GlassCard>
      ) : null}

      <GlassCard className="p-6">
        <div className="flex items-center gap-2">
          <Grid3x3 size={16} className="text-[var(--gold)]" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Mood × Suggestion Kind
          </h2>
        </div>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          Cell = acted / total · color-graded by hit rate (≥60% emerald
          · ≥35% amber · &lt;35% rose · no-data gray). Pre-Wave-H rows
          have no operator-state snapshot and don&apos;t appear in the grid.
        </p>

        {/* Grid · sticky first column · scrollable horizontally on mobile */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-[var(--bg-base)] px-2 py-1 text-left text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  mood ↓ / kind →
                </th>
                {data?.byKind.map((k) => (
                  <th
                    key={k.kind}
                    className="px-2 py-1 text-center text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]"
                  >
                    {k.kind}
                  </th>
                ))}
                <th className="px-2 py-1 text-center text-[10px] font-mono uppercase tracking-wider text-[var(--gold)]">
                  row total
                </th>
              </tr>
            </thead>
            <tbody>
              {data?.byMood.map((moodRow) => {
                const moodCells = data.cells.filter((c) => c.mood === moodRow.mood);
                const total = moodRow.total;
                const pct = moodRow.hitRatePct;
                return (
                  <tr key={moodRow.mood}>
                    <td className="sticky left-0 bg-[var(--bg-base)] px-2 py-1 text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      {MOOD_LABEL[moodRow.mood as Mood]}
                    </td>
                    {data.byKind.map((kindCol) => {
                      const cell = moodCells.find((c) => c.kind === kindCol.kind);
                      if (!cell) return <td key={kindCol.kind} />;
                      const display =
                        cell.total === 0
                          ? "—"
                          : `${cell.acted}/${cell.total}`;
                      return (
                        <td
                          key={kindCol.kind}
                          className={cn(
                            "rounded border px-2 py-1.5 text-center font-mono text-[11px] tabular-nums",
                            cellTone(cell.hitRatePct, cell.total),
                          )}
                          title={
                            cell.total === 0
                              ? "no samples in this cell"
                              : `${cell.acted} acted · ${cell.dismissed} dismissed · ${cell.hitRatePct}% hit`
                          }
                        >
                          {display}
                        </td>
                      );
                    })}
                    <td
                      className={cn(
                        "rounded border px-2 py-1.5 text-center font-mono text-[11px] tabular-nums",
                        cellTone(pct, total),
                      )}
                    >
                      {total === 0 ? "—" : `${moodRow.acted}/${total} (${pct}%)`}
                    </td>
                  </tr>
                );
              })}
              {/* Column totals row */}
              <tr>
                <td className="sticky left-0 bg-[var(--bg-base)] px-2 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--gold)]">
                  col total
                </td>
                {data?.byKind.map((k) => (
                  <td
                    key={k.kind}
                    className={cn(
                      "rounded border px-2 py-1.5 text-center font-mono text-[11px] tabular-nums",
                      cellTone(k.hitRatePct, k.total),
                    )}
                  >
                    {k.total === 0
                      ? "—"
                      : `${k.acted}/${k.total} (${k.hitRatePct}%)`}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </GlassCard>

      <p className="text-[11px] text-[var(--text-tertiary)]">
        LeCun-lens consolidation · M1 Closed-Loop Calibrated Brain.
        Reveals state-conditioned hit patterns invisible to chat-only
        agents · no competitor has the TaskEvent log + operator-state
        + suggestion-loop triple. As samples accumulate, the matrix
        becomes the substrate for state-aware gating (skip "task"
        suggestions when mood=depleted · prioritize "reflection" when
        drift is high · etc).
      </p>
    </StandardPage>
  );
}
