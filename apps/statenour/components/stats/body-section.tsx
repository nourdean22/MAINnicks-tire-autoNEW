"use client";

/**
 * BodySection · the Body section of the merged /stats surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/body/page.tsx — the only
 * changes are: the outer <StandardPage> wrapper became a fragment (the
 * page-level chrome now lives on /stats), and the former StandardPage
 * `description` + `actions` (the progress lbs/target readout + FreshnessChip)
 * moved into an inline header row at the top. Mounted lazily (next/dynamic,
 * ssr:false) from /stats so its recharts weight chart + 90d fetch stay
 * below the fold and don't tax first paint. The 60s poll, partial-upsert
 * quick-entry (weight/bf/waist/sleep/workout/energy/notes), progress
 * summary, chart, and recent-entries table are unchanged.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { logger as rootLogger } from "@/lib/logger";

// v10.0.31 — structured logger for body-section errors.
const log = rootLogger.withSurface("body/section");
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { PageNick } from "@/components/ai/page-nick";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { ErrorCard } from "@/components/ui/error-card";

// Phase XX (2026-05-19 AM) · authedFetch replaced with trpc · 2 sites
// (timeline read + check-in mutation) on the operator router.
import { trpc } from "@/lib/trpc/client";
interface BodyEntry {
  date: string;
  weight: number;
  body_fat_pct: number | null;
  waist_inches: number | null;
  notes: string | null;
}

interface Progress {
  current: number;
  target: number;
  delta: number;
  weeks_to_go: number;
  projected_date: string;
}

export function BodySection() {
  const [entries, setEntries] = useState<BodyEntry[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [waist, setWaist] = useState("");
  const [notes, setNotes] = useState("");
  // v10.0.529.106 · Wave 63b · health-as-decision-variable fields ·
  // log these so the MODE classifier can flip to RECOVERY on sleep<6h
  // + so the morning brief can adapt to body state. Each independent ·
  // operator can submit just sleep on the morning, just energy at noon.
  const [sleepHours, setSleepHours] = useState("");
  const [workoutDone, setWorkoutDone] = useState<boolean | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  // v10 B.1 FIND-09 · in-flight guard prevents double-tap from
  // creating duplicate weight entries on mobile.
  const [submitting, setSubmitting] = useState(false);

  // EF Quick-Log states
  const [efLogMode, setEfLogMode] = useState(false);
  const [efSleep, setEfSleep] = useState<string | null>(null); // "low" | "restful" | "optimized"
  const [efStress, setEfStress] = useState<number | null>(null); // 1 | 3 | 5
  const [showAdvanced, setShowAdvanced] = useState(false);

  // v10 B.1 FIND-03 · load wrapped in useCallback so the polling
  // interval captures a stable reference. setLoading(false) moved
  // into a finally block so a JSON-parse error or unexpected throw
  // can't leave the page stuck in the loading skeleton forever.
  // v10.0.31 — abort signal so a slow initial load doesn't get
  // overwritten by an interval-fired load that resolves first.
  const inflightRef = useRef<AbortController | null>(null);
  const utils = trpc.useUtils();
  const logEntryMutation = trpc.operator.logBodyEntry.useMutation();

  const load = useCallback(async () => {
    if (inflightRef.current) inflightRef.current.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      setError(null);
      const view = await utils.operator.bodyTracking.fetch({ range: "90d" });
      if (ctrl.signal.aborted) return;
      // Phase XX · normalize Prisma camelCase → page's snake_case
      // local BodyEntry shape. Pre-migration the REST route returned
      // Prisma data verbatim but the page's local type lied about
      // the field names · tRPC surfaces the truth · normalize here.
      const rawEntries = (view.entries ?? []) as Array<Record<string, unknown>>;
      const normalized = rawEntries.map((e) => ({
        ...e,
        body_fat_pct: e.bodyFatPct ?? null,
        waist_inches: e.waistInches ?? null,
        sleep_hours: e.sleepHours ?? null,
        workout_done: e.workoutDone ?? null,
      }));
      setEntries(normalized as unknown as typeof entries);
      setProgress(view.progress ?? null);
      // v-truth · FreshnessChip should reflect the LATEST WEIGH-IN date, not
      // the fetch time — else a 60-day-old weight always read "live". Robust
      // max over YYYY-MM-DD (lexical == chronological); falls back to now if
      // there are no entries.
      const latestEntryDate = normalized.reduce<string>(
        (max, e) => {
          const d = (e as { date?: string }).date ?? "";
          return d > max ? d : max;
        },
        "",
      );
      setFetchedAt(latestEntryDate || new Date().toISOString());
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      log.error("body_load_exception", {
        error: err instanceof Error ? err.message : String(err),
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [utils]);

  async function logWeight() {
    // v10.0.529.106 · Wave 63b · weight is no longer mandatory ·
    // sleep+workout+energy are independent health signals that can
    // be logged without a fresh weight reading.
    const hasAnyField =
      weight || bodyFat || waist || sleepHours || efSleep ||
      workoutDone !== null || energy !== null || efStress !== null || notes;
    if (!hasAnyField) return;
    if (submitting) return; // v10 B.1 FIND-09 · double-tap guard
    setSubmitting(true);
    try {
      // Phase XX · tRPC migration · typed Zod input · same partial-
      // upsert semantics server-side.
      await logEntryMutation.mutateAsync({
        weight: weight ? parseFloat(weight) : null,
        body_fat_pct: bodyFat ? parseFloat(bodyFat) : null,
        waist_inches: waist ? parseFloat(waist) : null,
        sleep_hours: efLogMode && efSleep
          ? (efSleep === "low" ? 5.5 : efSleep === "restful" ? 7.5 : 8.5)
          : sleepHours ? parseFloat(sleepHours) : null,
        workout_done: workoutDone,
        energy,
        stress: efLogMode && efStress !== null ? efStress : null,
        notes: notes ? `${notes} (EF Quick-Log)` : (efLogMode ? "EF Quick-Log" : null),
      });
      setWeight("");
      setBodyFat("");
      setWaist("");
      setSleepHours("");
      setWorkoutDone(null);
      setEnergy(null);
      setEfSleep(null);
      setEfStress(null);
      setNotes("");
      toast.success("Logged");
      load();
    } catch { toast.error("Network error"); }
    finally { setSubmitting(false); }
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 60000);
    return () => clearInterval(i);
  }, [load]);

  // Earliest weight entry as the starting baseline (entries are desc, so last = earliest)
  const startWeight = entries.length > 0 ? entries[entries.length - 1].weight : progress?.current ?? 0;

  const chartData = entries
    .slice()
    .reverse()
    .map((e) => ({
      date: e.date.slice(5),
      weight: e.weight,
    }));

  if (loading) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <div className="flex items-center justify-between">
          <ShimmerSkeleton className="h-8 w-24" />
          <ShimmerSkeleton className="h-10 w-32" />
        </div>
        <ShimmerSkeleton className="h-[250px] w-full" />
        <ShimmerSkeleton className="h-32 w-full" />
        <ShimmerSkeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorCard
        title="Failed to load body stats"
        message={error}
        domain="operator:bodyTracking"
        onRetry={load}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Former StandardPage description + actions, relocated inline. */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]" style={{ maxWidth: "60ch" }}>
          {/* 2026-06-10 · honest copy — the old "revenue follows within 5
              days" line asserted a measured correlation no data backs. */}
          When sleep, workouts, and energy slip, execution usually follows.
        </p>
        {progress && (
          <div className="text-right flex flex-col items-end gap-1 shrink-0">
            <span className="font-mono text-2xl font-bold text-[var(--text-primary)]">
              <AnimatedCounter value={progress.current} decimals={1} locale={false} />
            </span>
            <p className="text-[10px] text-[var(--text-tertiary)]">
              lbs · target {progress.target}
              {progress.current > progress.target &&
                ` · ${Math.round(progress.current - progress.target)} to go`}
            </p>
            <FreshnessChip
              lastFetchedAt={fetchedAt}
              source="db · body_entries"
              onReload={load}
            />
          </div>
        )}
      </div>

      <PageNick page="body" />

      {/* Progress Summary */}
      {progress && (
        <Card className="border-[var(--border-default)] bg-[var(--bg-raised)]">
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
              <span>Current</span>
              <span>Target: {progress.target} lbs</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--bg-raised)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#22c55e] transition-all duration-150 ease-in-out"
                style={{
                  width: `${Math.max(0, Math.min(100, Math.round(((startWeight - progress.current) / (startWeight - progress.target)) * 100)))}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Badge className="bg-[#22c55e]/10 text-[#22c55e] font-mono text-xs">
                {progress.delta} lbs to go
              </Badge>
              <span className="text-xs text-[var(--text-tertiary)]">
                ~{progress.weeks_to_go}w &middot; est. {progress.projected_date}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weight Chart */}
      {chartData.length > 0 && (
        <Card className="border-[var(--border-default)] bg-[var(--bg-raised)]">
          <CardHeader>
            <CardTitle className="text-sm text-[var(--text-tertiary)]">
              Weight (90 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="#1a1a1a" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#666666", fontSize: 10 }}
                  axisLine={{ stroke: "#1a1a1a" }}
                  tickLine={false}
                />
                <YAxis
                  domain={["dataMin - 2", "dataMax + 2"]}
                  tick={{ fill: "#666666", fontSize: 10 }}
                  axisLine={{ stroke: "#1a1a1a" }}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111111",
                    border: "1px solid #1a1a1a",
                    borderRadius: 8,
                    color: "#e5e5e5",
                    fontSize: 12,
                  }}
                />
                {progress && (
                  <ReferenceLine
                    y={progress.target}
                    stroke="#FDB913"
                    strokeDasharray="6 3"
                    label={{
                      value: `Target: ${progress.target}`,
                      fill: "#FDB913",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#e5e5e5"
                  strokeWidth={2}
                  dot={{ fill: "#e5e5e5", r: 2 }}
                  activeDot={{ fill: "#FDB913", r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Separator className="bg-[var(--bg-raised)]" />

      {/* Quick Entry Form */}
      <Card className="border-[var(--border-default)] bg-[var(--bg-raised)]">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm text-[var(--text-tertiary)]">Quick Entry</CardTitle>
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onClick={() => {
              const newMode = !efLogMode;
              setEfLogMode(newMode);
              if (newMode) setShowAdvanced(false);
              // reset inputs
              setWeight("");
              setBodyFat("");
              setWaist("");
              setSleepHours("");
              setWorkoutDone(null);
              setEnergy(null);
              setEfSleep(null);
              setEfStress(null);
              setNotes("");
            }}
            className="h-7 text-[10px] font-mono px-2 bg-white/[0.02] border border-white/10 text-zinc-400 hover:text-white"
          >
            {efLogMode ? "Normal Mode" : "EF Quick-Log ⚡"}
          </Button>
        </CardHeader>
        <CardContent>
          {efLogMode ? (
            <div className="space-y-4 animate-fade-in">
              {/* Sleep Taps */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] w-16">sleep</span>
                {[
                  { label: "deficit (<6h)", key: "low" },
                  { label: "restful (7.5h)", key: "restful" },
                  { label: "optimized (8.5h)", key: "optimized" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setEfSleep(opt.key)}
                    className={cn(
                      "min-h-[40px] px-3 rounded-md border text-[11px] transition-all",
                      efSleep === opt.key
                        ? opt.key === "low"
                          ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-200"
                          : "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Workout Taps */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] w-16">workout</span>
                {[
                  { label: "yes 💪", value: true },
                  { label: "rest ☕", value: false },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setWorkoutDone(opt.value)}
                    className={cn(
                      "min-h-[40px] px-4 rounded-md border text-[11px] transition-all",
                      workoutDone === opt.value
                        ? opt.value
                          ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                          : "border-zinc-500/40 bg-zinc-500/[0.08] text-zinc-300"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Energy Taps */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] w-16">energy</span>
                {[
                  { label: "🔋 1", value: 1 },
                  { label: "🔋 2", value: 2 },
                  { label: "⚡ 3", value: 3 },
                  { label: "⚡ 4", value: 4 },
                  { label: "🔥 5", value: 5 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEnergy(opt.value)}
                    className={cn(
                      "min-h-[40px] px-3 rounded-md border text-[11px] transition-all",
                      energy === opt.value
                        ? opt.value <= 2
                          ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-200"
                          : opt.value >= 4
                          ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                          : "border-sky-500/40 bg-sky-500/[0.08] text-sky-200"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Stress Taps */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] w-16">stress</span>
                {[
                  { label: "😌 low", value: 1 },
                  { label: "⚖️ stable", value: 3 },
                  { label: "⚠️ high", value: 5 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEfStress(opt.value)}
                    className={cn(
                      "min-h-[40px] px-3.5 rounded-md border text-[11px] transition-all",
                      efStress === opt.value
                        ? opt.value === 1
                          ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                          : opt.value === 3
                          ? "border-sky-500/40 bg-sky-500/[0.08] text-sky-200"
                          : "border-rose-500/40 bg-rose-500/[0.08] text-rose-200"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Advanced Accordion Toggle */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-all underline outline-none"
                >
                  {showAdvanced ? "Hide advanced fields" : "Show advanced fields (Weight, BF%, Waist, Notes)"}
                </button>
              </div>

              {showAdvanced && (
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/5 animate-fade-in">
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Weight (lbs)"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] font-mono text-xs"
                  />
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Body fat %"
                    value={bodyFat}
                    onChange={(e) => setBodyFat(e.target.value)}
                    className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] font-mono text-xs"
                  />
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Waist (in)"
                    value={waist}
                    onChange={(e) => setWaist(e.target.value)}
                    className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] font-mono text-xs"
                  />
                  <Input
                    type="text"
                    placeholder="Notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] text-xs col-span-2"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-2 gap-3 stagger-in">
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Weight (lbs)"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] font-mono"
                />
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Body fat %"
                  value={bodyFat}
                  onChange={(e) => setBodyFat(e.target.value)}
                  className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] font-mono"
                />
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Waist (in)"
                  value={waist}
                  onChange={(e) => setWaist(e.target.value)}
                  className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] font-mono"
                />
                <Input
                  type="number"
                  step="0.5"
                  placeholder="Sleep (h)"
                  value={sleepHours}
                  onChange={(e) => setSleepHours(e.target.value)}
                  className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] font-mono"
                />
                <Input
                  type="text"
                  placeholder="Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] col-span-2"
                />
              </div>

              {/* v10.0.529.106 · Wave 63b · workout toggle + 1-5 energy chip
                  row · the MODE classifier reads these. Editorial-minimalist
                  chips with 44px tap targets · mobile-first. */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] w-16">workout</span>
                {[
                  { label: "yes", value: true },
                  { label: "no", value: false },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setWorkoutDone(opt.value)}
                    className={cn(
                      "min-h-[44px] px-3 rounded-md border transition-all",
                      workoutDone === opt.value
                        ? opt.value
                          ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                          : "border-zinc-500/40 bg-zinc-500/[0.08] text-zinc-300"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
                <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] w-16 text-center">energy</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setEnergy(n)}
                    className={cn(
                      "min-h-[44px] w-10 rounded-md border font-mono transition-all",
                      energy === n
                        ? n <= 2
                          ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-200"
                          : n >= 4
                          ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-200"
                          : "border-sky-500/40 bg-sky-500/[0.08] text-sky-200"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20",
                    )}
                    aria-label={`energy ${n} of 5`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button
            size="sm"
            className="mt-3 w-full bg-[#FDB913] text-[#0a0a0a] hover:bg-[#FDB913]/80 font-bold uppercase tracking-wider h-10"
            onClick={logWeight}
            disabled={submitting || (
              efLogMode
                ? (!efSleep && workoutDone === null && energy === null && efStress === null && !weight && !bodyFat && !waist && !notes)
                : (!weight && !bodyFat && !waist && !sleepHours && workoutDone === null && energy === null && !notes)
            )}
          >
            {submitting ? "Logging…" : "Log Entry"}
          </Button>
        </CardContent>
      </Card>

      {/* Recent Entries Table */}
      {entries.length > 0 && (
        <Card className="border-[var(--border-default)] bg-[var(--bg-raised)]">
          <CardHeader>
            <CardTitle className="text-sm text-[var(--text-tertiary)]">
              Recent Entries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-0">
              {/* Table header */}
              <div className="grid grid-cols-4 gap-2 border-b border-[var(--border-default)] pb-2 mb-2">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                  Date
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] text-right">
                  Weight
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] text-right">
                  BF%
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] text-right">
                  Waist
                </span>
              </div>
              {entries.slice(0, 10).map((e) => (
                <div
                  /* v10.0.31 — was key={i}; on poll refresh a prepended
                     entry shifted indices and React swapped row data. */
                  key={e.date}
                  className="grid grid-cols-4 gap-2 py-1.5 border-b border-[var(--border-default)]/50 last:border-0"
                >
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {e.date.slice(5)}
                  </span>
                  <span className="text-xs font-mono text-[var(--text-primary)] text-right">
                    {e.weight}
                  </span>
                  <span className="text-xs font-mono text-[var(--text-tertiary)] text-right">
                    {e.body_fat_pct ?? "--"}
                  </span>
                  <span className="text-xs font-mono text-[var(--text-tertiary)] text-right">
                    {e.waist_inches ?? "--"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {entries.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <p className="text-xs text-[var(--text-tertiary)]">
            No entries yet. Log your first weight above.
          </p>
        </div>
      )}
    </div>
  );
}
