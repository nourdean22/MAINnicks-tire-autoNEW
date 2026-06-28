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
import type React from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { Sparkline } from "@/components/ui/sparkline";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronLeft, Grid3x3, Sparkles, Award } from "lucide-react";

type Mood = "energized" | "neutral" | "depleted" | "scattered";

const MOOD_LABEL: Record<Mood, string> = {
  energized: "energized",
  neutral: "neutral",
  depleted: "depleted",
  scattered: "scattered",
};

// 2026-05-23 · UI #2 · heatmap style cell · gradient saturation
// proportional to hit rate within color band. A 95% emerald cell is
// visibly more saturated than a 60% emerald cell · reads like a real
// heatmap. Inline `style` instead of dynamic Tailwind classes because
// Tailwind's JIT can't pre-generate runtime opacity strings.
//
// Sample-size matters · cells with total < 3 dim the saturation so
// "1 hit / 1 total = 100%" doesn't visually dominate a "30 hits /
// 50 total = 60%" cell. Operator sees confidence at a glance.
interface CellTone {
  /** Tailwind border + text classes · static · safe to use. */
  border: string;
  text: string;
  /** Inline style for the bg color · dynamic opacity. */
  bgStyle: React.CSSProperties;
}

function cellTone(pct: number, total: number): CellTone {
  if (total === 0 || pct < 0) {
    return {
      border: "border-[var(--border-default)]",
      text: "text-[var(--text-tertiary)]",
      bgStyle: { backgroundColor: "rgb(10 10 10 / 0.30)" },
    };
  }
  // Confidence dampener · cells with <3 samples render at half saturation.
  const confidence = total < 3 ? 0.5 : 1;

  if (pct >= 60) {
    // Emerald · rgb(16 185 129) · opacity ramps 0.05 → 0.22 across 60→100%.
    const dist = Math.min(1, (pct - 60) / 40);
    const opacity = (0.05 + dist * 0.17) * confidence;
    return {
      border: "border-emerald-500/30",
      text: "text-emerald-300",
      bgStyle: { backgroundColor: `rgb(16 185 129 / ${opacity.toFixed(3)})` },
    };
  }
  if (pct >= 35) {
    // Amber · rgb(245 158 11) · 0.04 → 0.16 across 35→60%.
    const dist = Math.min(1, (pct - 35) / 25);
    const opacity = (0.04 + dist * 0.12) * confidence;
    return {
      border: "border-amber-500/30",
      text: "text-amber-300",
      bgStyle: { backgroundColor: `rgb(245 158 11 / ${opacity.toFixed(3)})` },
    };
  }
  // Rose · rgb(244 63 94) · LOWER pct = HIGHER saturation (poor performance
  // is visually loud · operator should see it first).
  const dist = (35 - pct) / 35;
  const opacity = (0.06 + dist * 0.16) * confidence;
  return {
    border: "border-rose-500/30",
    text: "text-rose-300",
    bgStyle: { backgroundColor: `rgb(244 63 94 / ${opacity.toFixed(3)})` },
  };
}

export default function CalibrationPage() {
  const { data, isLoading, error, refetch, dataUpdatedAt } =
    trpc.system.stateCalibration.useQuery(
      { sinceDays: 30 },
      { refetchOnWindowFocus: false },
    );

  const {
    data: judgeData,
    isLoading: isJudgeLoading,
    error: judgeError,
    refetch: refetchJudge,
  } = trpc.system.judgeEvalCalibration.useQuery(
    { sinceDays: 30 },
    { refetchOnWindowFocus: false },
  );

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="State Calibration"
      description={
        // 2026-05-23 · Wave M · "failed to load" distinct from empty.
        // 2026-05-24 · Wave N · surface non-zero malformed +
        // unknownMood counters in the header so prod diagnosis
        // doesn't require opening the response payload. Zero
        // values stay hidden to keep the chip clean in the
        // common case.
        error
          ? "failed to load"
          : data
            ? [
                `${data.totalRows} actions`,
                `${data.unstamped} pre-Wave-H`,
                data.malformed > 0 ? `${data.malformed} malformed` : null,
                data.unknownMood > 0 ? `${data.unknownMood} unknown-mood` : null,
                `${data.sinceDays}d`,
              ]
                .filter(Boolean)
                .join(" · ")
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
            onReload={() => {
              void refetch();
              void refetchJudge();
            }}
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
          Heatmap saturation = hit rate · brighter cell = more lift.
          Row sparkline = mood&apos;s hit rate over {data?.sinceDays ?? 30}d ·
          col sparkline = kind&apos;s hit rate over time. Pre-Wave-H rows
          (no operator-state snapshot) excluded from the grid.
        </p>

        {/* 2026-05-23 · UI #7 · empty state when the operator hasn't
            yet acted on / dismissed a single state-stamped suggestion.
            Pre-fix the grid rendered as a sea of "—" cells which read
            as "broken" rather than "warming up." This callout teaches
            the operator how the grid fills · removes the cold-start
            confusion · and matches the editorial palette (gold accent
            on dark · concentric icon vocabulary from the operator-
            state pulse). Branch keys off totalRows because that's the
            inclusive count (stamped + unstamped) · zero means "no
            suggestion-loop activity at all" · the truly empty case. */}
        {!isLoading && !error && data && data.totalRows === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)]/30 px-6 py-10 text-center">
            <div className="relative">
              <div className="absolute inset-0 -m-1 rounded-full border border-[var(--gold)]/20" aria-hidden />
              <div className="absolute inset-0 -m-3 rounded-full border border-[var(--gold)]/10" aria-hidden />
              <Sparkles size={28} className="relative text-[var(--gold)]" aria-hidden />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                Grid warming up
              </h3>
              <p className="mx-auto max-w-sm text-xs text-[var(--text-secondary)]">
                Your mood × kind matrix fills as you tap or dismiss
                Nick&apos;s suggestion chips. Each chip stamps the
                current operator-state · the grid reveals which
                kinds land in which moods.
              </p>
            </div>
            <ol className="space-y-1.5 text-[11px] text-[var(--text-tertiary)]">
              <li className="flex items-center gap-2">
                <span className="font-mono text-[var(--gold)]/70">1.</span>
                <span>Visit <Link href="/" className="text-[var(--text-secondary)] hover:text-[var(--gold)] transition-colors">/</Link> · Nick surfaces chips based on your state</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono text-[var(--gold)]/70">2.</span>
                <span>Tap a chip to act · or × to dismiss · both are signal</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="font-mono text-[var(--gold)]/70">3.</span>
                <span>Return here · cells light up by mood × kind hit rate</span>
              </li>
            </ol>
          </div>
        ) : null}

        {/* Grid · sticky first column · scrollable horizontally on mobile.
            2026-05-23 · UI #2 · cells use heatmap saturation (cellTone
            returns inline-style bg with opacity scaled to hit rate).
            Row + col totals also carry sparklines so the time-trend
            is visible without a separate chart.
            2026-05-23 · UI #7 · hidden when totalRows === 0 · the
            empty-state callout above replaces the blank grid. */}
        <div className={cn("mt-4 overflow-x-auto", data && data.totalRows === 0 && "hidden")}>
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
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{k.kind}</span>
                      {k.total > 0 && k.trend.length > 0 ? (
                        <span className="text-[var(--text-tertiary)]">
                          <Sparkline
                            data={k.trend}
                            width={48}
                            height={10}
                            color="rgb(253 185 19)"
                            fillOpacity={0.08}
                            showDot={false}
                            animate={false}
                          />
                        </span>
                      ) : null}
                    </div>
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
                const rowTone = cellTone(pct, total);
                return (
                  <tr key={moodRow.mood}>
                    <td className="sticky left-0 bg-[var(--bg-base)] px-2 py-1 text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      <div className="flex flex-col gap-0.5">
                        <span>{MOOD_LABEL[moodRow.mood as Mood]}</span>
                        {moodRow.total > 0 && moodRow.trend.length > 0 ? (
                          <span className="text-[var(--text-tertiary)]">
                            <Sparkline
                              data={moodRow.trend}
                              width={56}
                              height={10}
                              color="rgb(253 185 19)"
                              fillOpacity={0.08}
                              showDot={false}
                              animate={false}
                            />
                          </span>
                        ) : null}
                      </div>
                    </td>
                    {data.byKind.map((kindCol) => {
                      const cell = moodCells.find((c) => c.kind === kindCol.kind);
                      if (!cell) return <td key={kindCol.kind} />;
                      const display =
                        cell.total === 0
                          ? "—"
                          : `${cell.acted}/${cell.total}`;
                      const tone = cellTone(cell.hitRatePct, cell.total);
                      return (
                        <td
                          key={kindCol.kind}
                          style={tone.bgStyle}
                          className={cn(
                            "rounded border px-2 py-1.5 text-center font-mono text-[11px] tabular-nums transition-colors",
                            tone.border,
                            tone.text,
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
                      style={rowTone.bgStyle}
                      className={cn(
                        "rounded border px-2 py-1.5 text-center font-mono text-[11px] tabular-nums",
                        rowTone.border,
                        rowTone.text,
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
                {data?.byKind.map((k) => {
                  const tone = cellTone(k.hitRatePct, k.total);
                  return (
                    <td
                      key={k.kind}
                      style={tone.bgStyle}
                      className={cn(
                        "rounded border px-2 py-1.5 text-center font-mono text-[11px] tabular-nums",
                        tone.border,
                        tone.text,
                      )}
                    >
                      {k.total === 0
                        ? "—"
                        : `${k.acted}/${k.total} (${k.hitRatePct}%)`}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <div className="flex items-center gap-2">
          <Award size={16} className="text-[var(--gold)]" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            LLM Judge Calibration
          </h2>
        </div>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          Measures agreement % between LLM judge verdicts (did V2 beat V1?) and your manual thumbs-up/down on chat replies.
        </p>

        {isJudgeLoading ? (
          <div className="mt-4 text-xs text-[var(--text-tertiary)]">Loading calibration metrics...</div>
        ) : judgeError ? (
          <div className="mt-4 text-xs text-rose-400">Failed to load judge calibration: {judgeError.message}</div>
        ) : judgeData ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[var(--bg-elevated)]/40 p-4 border border-[var(--border-default)]">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase text-[var(--text-secondary)]">Verdict:</span>
                  <span className={cn(
                    "text-xs font-semibold px-2 py-0.5 rounded border uppercase tracking-wider",
                    judgeData.verdict === "well-calibrated" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
                    judgeData.verdict === "moderate" && "bg-amber-500/10 border-amber-500/30 text-amber-300",
                    judgeData.verdict === "miscalibrated" && "bg-rose-500/10 border-rose-500/30 text-rose-300",
                    judgeData.verdict === "preliminary" && "bg-[var(--bg-surface)] border-[var(--border-default)] text-[var(--text-secondary)]"
                  )}>
                    {judgeData.verdict.replace("-", " ")}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)] max-w-md">
                  {judgeData.verdictReason}
                </p>
              </div>

              <div className="text-right">
                <div className="text-2xl font-bold font-mono text-[var(--gold)]">
                  {judgeData.agreementPct >= 0 ? `${judgeData.agreementPct.toFixed(1)}%` : "—"}
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)] font-mono uppercase">
                  Agreement (n={judgeData.totalScored})
                </div>
              </div>
            </div>

            {judgeData.totalScored > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)]/20 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                    Confusion Matrix
                  </div>
                  <table className="w-full text-center border-separate border-spacing-1">
                    <thead>
                      <tr>
                        <th className="text-[9px] font-mono text-[var(--text-tertiary)] text-left">Judge ↓ / Human →</th>
                        <th className="text-[9px] font-mono text-emerald-400 py-0.5 bg-emerald-500/5 rounded border border-emerald-500/10">+1 Thumbs Up</th>
                        <th className="text-[9px] font-mono text-rose-400 py-0.5 bg-rose-500/5 rounded border border-rose-500/10">-1 Thumbs Down</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="text-[10px] font-semibold text-zinc-300 text-left font-mono">Preferred V2</td>
                        <td className="bg-emerald-500/10 text-emerald-300 text-xs font-mono py-1.5 rounded border border-emerald-500/20" title="Agreement: Judge picked V2, Human liked V2">
                          {judgeData.matrix.find(c => c.judge === "v2" && c.human === "thumbs_up")?.count ?? 0}
                        </td>
                        <td className="bg-rose-500/10 text-rose-300 text-xs font-mono py-1.5 rounded border border-rose-500/20" title="Disagree: Judge picked V2, Human disliked V2 (False Positive)">
                          {judgeData.matrix.find(c => c.judge === "v2" && c.human === "thumbs_down")?.count ?? 0}
                        </td>
                      </tr>
                      <tr>
                        <td className="text-[10px] font-semibold text-zinc-300 text-left font-mono">Preferred V1</td>
                        <td className="bg-rose-500/10 text-rose-300 text-xs font-mono py-1.5 rounded border border-rose-500/20" title="Disagree: Judge picked V1, Human liked V2 (False Negative)">
                          {judgeData.matrix.find(c => c.judge === "v1" && c.human === "thumbs_up")?.count ?? 0}
                        </td>
                        <td className="bg-emerald-500/10 text-emerald-300 text-xs font-mono py-1.5 rounded border border-emerald-500/20" title="Agreement: Judge picked V1, Human disliked V2">
                          {judgeData.matrix.find(c => c.judge === "v1" && c.human === "thumbs_down")?.count ?? 0}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)]/20 p-3 space-y-2 flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                      Exclusion Summary
                    </div>
                    <ul className="text-[11px] text-[var(--text-secondary)] space-y-1 font-mono">
                      <li className="flex justify-between">
                        <span>Tied judgments:</span>
                        <span className="text-[var(--text-primary)]">{judgeData.ties}</span>
                      </li>
                      <li className="flex justify-between">
                        <span>No human feedback:</span>
                        <span className="text-[var(--text-primary)]">{judgeData.noOperatorReaction}</span>
                      </li>
                      <li className="flex justify-between">
                        <span>No source message:</span>
                        <span className="text-[var(--text-primary)]">{judgeData.noSourceMessage}</span>
                      </li>
                    </ul>
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] italic">
                    Ties, unrated replies, and synthetic evaluations are excluded from calibration percentages.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-tertiary)] py-4 text-center border border-dashed border-[var(--border-default)] rounded-lg">
                No human-evaluated comparisons in the last 30 days to calibrate the LLM judge.
              </p>
            )}
          </div>
        ) : null}
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
