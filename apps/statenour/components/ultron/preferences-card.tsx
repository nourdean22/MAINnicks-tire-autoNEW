"use client";

/**
 * PreferencesCard · v10.0.529.33 · Arc B Feature 1 · operator-facing
 * visibility + manual override for the 8-axis preference vector.
 *
 * The preference-inference subsystem has been silently observing
 * thumbs-feedback since v10.0.526 · this card surfaces what's been
 * inferred AND gives the operator a manual dial per axis. Power +
 * control alignment · every dial exposed · every automation
 * overridable.
 *
 * Data contract:
 *   · GET  /api/system/preference-vector
 *   · POST /api/system/preference-vector body { vector, reset? }
 *
 * Surface design (frontend-design · DFII 10):
 *   · 8 horizontal sliders · one per axis · -1 to +1
 *   · Each slider's track has a midline marker · the zero point
 *   · Axis name on left · value on right · tabular nums
 *   · Drift hint: if last-tune delta is non-trivial, show a small
 *     ↑ / ↓ arrow next to the value with the magnitude
 *   · "Save" button gated behind isDirty · prevents accidental
 *     submission · operator-grade discipline
 *   · "Reset to neutral" button on the header · destructive · gated
 *     behind a confirm tap (second click within 4s)
 *   · Bottom: rendered addendum preview · the actual text Nick sees
 *     in his system prompt · transparency about what's being applied
 *   · Silent on first load until data arrives (ShimmerSkeleton)
 *
 * The card never tries to be the FULL settings page · it's the daily
 * touchpoint. Deeper history + per-axis tune-trace lives on /brain
 * (future · v10.0.529.33+1 scope).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Save, Loader2, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const AXES = [
  "density",
  "creativity",
  "skepticism",
  "directness",
  "humor",
  "jargon",
  "structure",
  "urgency",
] as const;
type Axis = (typeof AXES)[number];
type PreferenceVector = Record<Axis, number>;

const DEFAULT_VECTOR: PreferenceVector = {
  density: 0,
  creativity: 0,
  skepticism: 0,
  directness: 0,
  humor: 0,
  jargon: 0,
  structure: 0,
  urgency: 0,
};

interface LastTune {
  date: string;
  sampleSize: number;
  learningRate: number;
  prev: PreferenceVector;
  next: PreferenceVector;
  delta: PreferenceVector;
}

interface TuneTracePoint {
  date: string;
  vector: PreferenceVector;
  sampleSize: number;
}

interface ApiShape {
  ok?: boolean;
  vector?: PreferenceVector;
  addendum?: string;
  lastTune?: LastTune | null;
  trace?: TuneTracePoint[];
}

/**
 * Per-axis sparkline · plots up to 12 weeks of post-tune values on a
 * normalized -1 to +1 vertical range. Tiny inline SVG · zero deps ·
 * keeps the card's render cost flat. Hidden when there are fewer
 * than 2 points (can't draw a line) · skipped at the call site.
 */
function AxisSparkline({
  axis,
  trace,
  width = 60,
  height = 14,
}: {
  axis: Axis;
  trace: TuneTracePoint[];
  width?: number;
  height?: number;
}) {
  if (!trace || trace.length < 2) return null;
  const padding = 1;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const step = innerW / (trace.length - 1);
  // Map -1 → bottom · +1 → top · 0 → midline
  const yFor = (v: number) => padding + innerH * (1 - (v + 1) / 2);
  const points = trace
    .map((p, i) => `${padding + i * step},${yFor(p.vector[axis] ?? 0).toFixed(1)}`)
    .join(" ");
  const lastValue = trace[trace.length - 1].vector[axis] ?? 0;
  const stroke =
    lastValue > 0.15
      ? "var(--gold)"
      : lastValue < -0.15
        ? "rgb(251 191 36)" // amber-400 · keeps the trend visible without leaving the palette
        : "var(--text-tertiary)";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="opacity-70"
    >
      {/* midline · zero · barely visible */}
      <line
        x1={padding}
        y1={yFor(0)}
        x2={padding + innerW}
        y2={yFor(0)}
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth="0.5"
      />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Editorial copy per axis · what each pole means in operator-natural
// language. Used for the axis label tooltip + the bar's slider title.
const AXIS_TELLS: Record<Axis, { left: string; right: string; label: string }> = {
  density: { label: "density", left: "terse", right: "verbose" },
  creativity: { label: "creativity", left: "factual", right: "creative" },
  skepticism: { label: "skepticism", left: "committed", right: "hedging" },
  directness: { label: "directness", left: "cushioned", right: "blunt" },
  humor: { label: "humor", left: "serious", right: "playful" },
  jargon: { label: "jargon", left: "plain", right: "technical" },
  structure: { label: "structure", left: "prose", right: "bulleted" },
  urgency: { label: "urgency", left: "calm", right: "urgent" },
};

function clamp(n: number, lo: number = -1, hi: number = 1): number {
  if (!Number.isFinite(n)) return 0;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function vectorsEqual(a: PreferenceVector, b: PreferenceVector): boolean {
  for (const axis of AXES) {
    if (Math.abs(a[axis] - b[axis]) > 0.0001) return false;
  }
  return true;
}

function daysAgo(dateStr: string): number | null {
  // dateStr from cron heartbeat is YYYY-MM-DD · parse to noon UTC
  // so we don't fight DST edge cases.
  const t = Date.parse(`${dateStr}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400_000));
}

export function PreferencesCard() {
  // Phase B.6c (2026-05-22) · migrated off `useUltronFetch("/api/system/
  // preference-vector")` + two `authedFetch` POSTs onto `trpc.system.
  // preferenceVector` (reactive read) + `trpc.system.savePreferenceVector`
  // (mutation). The legacy 5-min poll is now `refetchInterval`. React
  // Query keeps `data` defined across background refetches, so the
  // draft-seed effect + isDirty gate behave exactly as before. The
  // procedure returns the view object directly (the legacy route also
  // returned it unwrapped).
  const pref = trpc.system.preferenceVector.useQuery(undefined, {
    refetchInterval: 300_000,
    staleTime: 300_000,
  });
  const utils = trpc.useUtils();
  const saveMutation = trpc.system.savePreferenceVector.useMutation();

  // Local edit state · seeded from API · isDirty drives the Save gate.
  const [draft, setDraft] = useState<PreferenceVector | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showAddendum, setShowAddendum] = useState(false);

  const data: ApiShape | undefined = pref.data;

  // Seed draft from API on first load · subsequent polls don't wipe
  // unsaved edits (operator might be mid-drag when a refetch lands).
  useEffect(() => {
    if (draft || !data?.vector) return;
    setTimeout(() => setDraft(data.vector!), 0);
  }, [data?.vector, draft]);

  // Reset-confirm auto-clears after 4s if not pressed.
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  const apiVector = data?.vector ?? null;
  const isDirty = draft !== null && apiVector !== null && !vectorsEqual(draft, apiVector);

  const setAxis = useCallback((axis: Axis, value: number) => {
    setDraft((cur) => {
      const base = cur ?? { ...DEFAULT_VECTOR };
      return { ...base, [axis]: clamp(value) };
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft || !isDirty) return;
    setSaving(true);
    const toastId = toast.loading("saving preferences…");
    try {
      const patch: Partial<PreferenceVector> = {};
      if (apiVector) {
        for (const axis of AXES) {
          if (Math.abs(draft[axis] - apiVector[axis]) > 0.0001) {
            patch[axis] = draft[axis];
          }
        }
      }
      await saveMutation.mutateAsync({ vector: patch });
      toast.success("preferences saved · applies to the next chat turn", { id: toastId });
      await utils.system.preferenceVector.invalidate();
    } catch {
      toast.error("save failed", { id: toastId });
    } finally {
      setSaving(false);
    }
  }, [draft, apiVector, isDirty, saveMutation, utils]);

  const handleReset = useCallback(async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setSaving(true);
    setConfirmReset(false);
    const toastId = toast.loading("resetting to neutral…");
    try {
      await saveMutation.mutateAsync({ vector: {}, reset: true });
      setDraft({ ...DEFAULT_VECTOR });
      toast.success("preferences reset · all axes neutral", { id: toastId });
      await utils.system.preferenceVector.invalidate();
    } catch {
      toast.error("reset failed", { id: toastId });
    } finally {
      setSaving(false);
    }
  }, [confirmReset, saveMutation, utils]);

  if (pref.isLoading && !data) {
    return <ShimmerSkeleton variant="card" className="min-h-[180px]" />;
  }

  const vector = draft ?? apiVector ?? DEFAULT_VECTOR;
  const lastTune = data?.lastTune ?? null;
  const tuneAge = lastTune ? daysAgo(lastTune.date) : null;
  const addendum = data?.addendum ?? "";
  const trace = data?.trace ?? [];
  const hasTrace = trace.length >= 2;

  return (
    <GlassCard
      className="min-h-[180px] border-[var(--gold)]/25 bg-[var(--gold)]/[0.03]"
      data-testid="preferences-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          style · preferences
          <span className="rounded-sm border border-[var(--gold)]/30 px-1 py-px text-[9px] tabular-nums text-[var(--gold)]">
            8 axis
          </span>
        </span>
        <div className="flex items-center gap-1.5">
          {lastTune && tuneAge !== null && (
            <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] tabular-nums">
              tuned {tuneAge}d ago · n={lastTune.sampleSize}
            </span>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            aria-label={confirmReset ? "confirm reset to neutral" : "reset preferences"}
            title={
              confirmReset
                ? "click again within 4s to zero all axes"
                : "reset all axes to neutral"
            }
            className={cn(
              "shrink-0 -my-0.5 p-1 rounded transition-colors",
              "min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px] flex items-center justify-center",
              confirmReset
                ? "bg-rose-400/15 text-rose-300 border border-rose-400/45"
                : "text-[var(--text-tertiary)] hover:text-rose-300 hover:bg-rose-400/[0.08]",
            )}
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </div>

      {/* 8-axis sliders · single column on mobile · 2-col grid on sm+
          so the operator sees all 8 above the fold on most screens. */}
      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {AXES.map((axis) => {
          const v = vector[axis];
          const tell = AXIS_TELLS[axis];
          const delta = lastTune?.delta[axis] ?? 0;
          const driftHint = Math.abs(delta) >= 0.02; // skip noise · only show when meaningful
          return (
            <div key={axis} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-secondary)]"
                  title={`${tell.left} (−1) ↔ ${tell.right} (+1)`}
                >
                  {tell.label}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono tabular-nums text-[var(--text-primary)]">
                  {/* v529.39 · per-axis trace sparkline · last 12
                      weekly tunes plotted left-to-right · -1 to +1
                      normalized vertical · gold when current value
                      is positive · amber when negative · tertiary
                      when neutral. Hidden when <2 points (no line). */}
                  {hasTrace && <AxisSparkline axis={axis} trace={trace} />}
                  <span>
                    {v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)}
                  </span>
                  {driftHint && (
                    <span
                      className={cn(
                        "text-[8.5px] tabular-nums",
                        delta > 0 ? "text-emerald-400/80" : "text-amber-400/80",
                      )}
                      title={`last tune: ${delta > 0 ? "+" : ""}${delta.toFixed(3)}`}
                    >
                      {delta > 0 ? "↑" : "↓"}
                      {Math.abs(delta).toFixed(2)}
                    </span>
                  )}
                </span>
              </div>
              {/* Slider · native range input · accessible · keyboard-
                  navigable · matches OS visual conventions. Custom
                  CSS would fight the operator's mental model. */}
              <div className="relative">
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={v}
                  disabled={saving}
                  onChange={(e) => setAxis(axis, Number(e.target.value))}
                  className={cn(
                    "w-full h-3 appearance-none cursor-pointer bg-transparent",
                    "[&::-webkit-slider-runnable-track]:h-[2px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[var(--border-default)]",
                    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--gold)] [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_var(--bg-void)]",
                    "[&::-moz-range-track]:h-[2px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--border-default)]",
                    "[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--gold)] [&::-moz-range-thumb]:border-0",
                    saving && "opacity-50",
                  )}
                  aria-label={`${tell.label} · ${tell.left} to ${tell.right}`}
                />
                {/* Midline · the zero marker · helps the eye anchor */}
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1px] h-[6px] bg-[var(--text-tertiary)]/40 pointer-events-none"
                />
              </div>
              <div className="flex justify-between text-[8.5px] font-mono text-[var(--text-tertiary)]/70">
                <span>{tell.left}</span>
                <span>{tell.right}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action row · save gated behind isDirty · addendum toggle */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowAddendum((v) => !v)}
          className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
          aria-expanded={showAddendum}
        >
          {showAddendum ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {addendum.length > 0 ? `show what Nick sees · ${addendum.length} chars` : "no prompt addendum yet · all axes neutral"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saving}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-colors",
            "min-h-[28px]",
            saving
              ? "bg-[var(--bg-surface)] border-[var(--border-hover)] text-[var(--text-tertiary)]"
              : !isDirty
                ? "bg-transparent border-[var(--border-default)] text-[var(--text-tertiary)] cursor-not-allowed"
                : "bg-[var(--gold)]/15 border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/25",
          )}
        >
          {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
          {saving ? "saving…" : "save"}
        </button>
      </div>

      {/* Addendum preview · the actual text Nick sees in the system
          prompt · transparency. When all axes are neutral the
          addendum is empty and we show nothing. */}
      {showAddendum && addendum.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[var(--border-default)]/30">
          <div className="inline-flex items-center gap-1.5 text-[8.5px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/70 mb-1">
            <Sparkles size={9} />
            system prompt addendum
          </div>
          <pre className="text-[10.5px] leading-[1.5] text-[var(--text-tertiary)] whitespace-pre-wrap font-mono">
            {addendum}
          </pre>
        </div>
      )}
    </GlassCard>
  );
}
