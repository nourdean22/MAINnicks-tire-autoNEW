"use client";

/**
 * /system/cron-runs/[jobName] · v8.14 · Apr 29.
 *
 * Per-job cron-run history drill-down. Reads
 * /api/system/cron-runs/[jobName] and renders:
 *   · Header chip: success rate + median + p95 duration
 *   · Window selector (1d/7d/30d)
 *   · Timeline of last N runs with status pills + duration
 *   · Inline error preview for failed runs (click to expand)
 *
 * Closes a real gap in operator visibility — the existing
 * /system/cron-diagnostics shows 48h aggregate counts; this page
 * surfaces the per-run trail so debugging "why did this job fail
 * at 3am" doesn't require digging in the database.
 */

import { useCallback, useEffect, useMemo, useState, use } from "react";
import { PageHeader } from "@/components/layout/ui";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Sparkline } from "@/components/ui/sparkline";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { CheckCircle2, XCircle, ChevronDown, ChevronUp, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface RunPayload {
  jobName: string;
  sinceDays: number;
  counts: { total: number; success: number; fail: number };
  successRate: number | null;
  median: number | null;
  p95: number | null;
  runs: Array<{
    id: string;
    status: string;
    durationMs: number | null;
    errorPreview: string | null;
    createdAt: string;
  }>;
  generatedAt: string;
}

const WINDOW_OPTIONS = [
  { v: 1, label: "1d" },
  { v: 7, label: "7d" },
  { v: 30, label: "30d" },
  { v: 90, label: "90d" },
];

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function fullTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface PageProps {
  params: Promise<{ jobName: string }>;
}

export default function CronRunsPage({ params }: PageProps) {
  const { jobName } = use(params);
  const decoded = decodeURIComponent(jobName);
  const [data, setData] = useState<RunPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [sinceDays, setSinceDays] = useState(7);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(
        `/api/system/cron-runs/${encodeURIComponent(decoded)}?sinceDays=${sinceDays}&limit=200`,
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { data?: RunPayload } & RunPayload;
      setData(j.data ?? (j as RunPayload));
      setLastFetched(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [decoded, sinceDays]);

  useEffect(() => {
    void load();
  }, [load]);

  // v8.18 · sparkline of successful-run durations, oldest → newest.
  // Failures (duration null) are excluded so the trend isn't dominated
  // by the zero-duration failure case.
  const durationSpark = useMemo<number[]>(() => {
    if (!data) return [];
    return data.runs
      .filter((r) => r.status === "success" && typeof r.durationMs === "number")
      .map((r) => r.durationMs as number)
      .reverse();
  }, [data]);

  // v8.19 · Run-now action. Posts to /api/system/crons/run which
  // validates the name against the manifest, fires the cron, and
  // returns timing. Refreshes the run list afterward so the new entry
  // appears at the top.
  const runNow = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await authedFetch("/api/system/crons/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobName: decoded }),
      });
      const json = (await res.json()) as {
        data?: { ok?: boolean; durationMs?: number; status?: number };
        error?: string;
      };
      if (!res.ok) {
        toast.error(`run failed: ${json.error ?? res.statusText}`);
      } else {
        const ms = json.data?.durationMs ?? 0;
        toast.success(`${decoded} ran · ${ms}ms`);
        await load();
      }
    } catch (err) {
      toast.error(`run failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRunning(false);
    }
  }, [decoded, running, load]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader parentHref="/system" parentLabel="system"
        eyebrow="System · Cron runs"
        title={decoded}
        description="Per-job run history · success rate · timing trend · error log"
      />

      <Panel className="mt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            {data && (
              <>
                <Stat
                  label="success rate"
                  value={data.successRate ?? 0}
                  suffix="%"
                  decimals={1}
                  tone={
                    data.successRate == null
                      ? "default"
                      : data.successRate >= 95
                        ? "emerald"
                        : data.successRate >= 80
                          ? "amber"
                          : "rose"
                  }
                />
                <Stat label="median" value={data.median ?? 0} format={fmtMs} />
                <Stat label="p95" value={data.p95 ?? 0} format={fmtMs} />
                <Stat
                  label="total"
                  value={data.counts.total}
                  tone="default"
                />
                <Stat
                  label="failures"
                  value={data.counts.fail}
                  tone={data.counts.fail > 0 ? "rose" : "default"}
                />
                {durationSpark.length >= 3 && (
                  <div className="flex flex-col">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                      duration trend
                    </span>
                    <Sparkline
                      data={durationSpark}
                      width={140}
                      height={28}
                      color="var(--gold)"
                      fillOpacity={0.15}
                      showDot
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runNow}
              disabled={running}
              className={
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider transition-colors " +
                (running
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200 cursor-wait"
                  : "border-sky-500/40 bg-sky-500/[0.08] text-sky-300 hover:bg-sky-500/15")
              }
              title="Trigger this cron now"
            >
              {running ? (
                <>
                  <Loader2 size={11} className="animate-spin" /> running
                </>
              ) : (
                <>
                  <Play size={11} /> run now
                </>
              )}
            </button>
            <FreshnessChip
              lastFetchedAt={lastFetched}
              source={`api/system/cron-runs/${decoded}`}
              onReload={() => void load()}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            window:
          </span>
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setSinceDays(opt.v)}
              className={
                "rounded-full border px-2 py-0.5 text-[10px] font-mono transition-colors " +
                (sinceDays === opt.v
                  ? "border-zinc-500 bg-zinc-700/50 text-zinc-100"
                  : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-200")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="mt-4">
        {error && !data && (
          <p className="rounded border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] text-rose-200">
            {error}
          </p>
        )}

        {loading && !data && (
          <p className="text-[11px] text-zinc-500">loading…</p>
        )}

        {data && data.runs.length === 0 && (
          <p className="text-[11px] text-zinc-500">
            No runs logged for &quot;{decoded}&quot; in the last {sinceDays}d.
            {sinceDays < 90 && " Try a wider window."}
          </p>
        )}

        {data && data.runs.length > 0 && (
          <ul className="space-y-1 stagger-in">
            {data.runs.map((run) => {
              const isFail = run.status !== "success";
              const expanded = expandedRun === run.id;
              return (
                <li
                  key={run.id}
                  className={
                    "rounded-md border " +
                    (isFail
                      ? "border-rose-500/30 bg-rose-500/[0.03]"
                      : "border-zinc-800 bg-zinc-950/40")
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRun((cur) => (cur === run.id ? null : run.id))
                    }
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-[11px]"
                    title={fullTime(run.createdAt)}
                  >
                    {isFail ? (
                      <XCircle size={12} className="text-rose-400 shrink-0" />
                    ) : (
                      <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                    )}
                    <span
                      className={
                        "font-mono " + (isFail ? "text-rose-300" : "text-emerald-300")
                      }
                    >
                      {run.status}
                    </span>
                    <span className="text-zinc-500">{relTime(run.createdAt)}</span>
                    <span className="ml-auto font-mono text-zinc-500">
                      {fmtMs(run.durationMs)}
                    </span>
                    {run.errorPreview && (
                      expanded ? (
                        <ChevronUp size={12} className="text-zinc-500" />
                      ) : (
                        <ChevronDown size={12} className="text-zinc-500" />
                      )
                    )}
                  </button>
                  {expanded && run.errorPreview && (
                    <pre className="border-t border-rose-500/20 bg-rose-500/[0.05] px-3 py-2 text-[10px] font-mono text-rose-200 whitespace-pre-wrap break-all">
                      {run.errorPreview}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </main>
  );
}

function Stat({
  label,
  value,
  suffix = "",
  decimals = 0,
  format,
  tone = "default",
}: {
  label: string;
  value: number;
  suffix?: string;
  decimals?: number;
  format?: (n: number) => string;
  tone?: "default" | "emerald" | "amber" | "rose";
}) {
  const tint =
    tone === "emerald"
      ? "text-emerald-200"
      : tone === "amber"
        ? "text-amber-200"
        : tone === "rose"
          ? "text-rose-200"
          : "text-zinc-200";
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <span className={`text-base font-bold tabular-nums ${tint}`}>
        {format ? (
          format(value)
        ) : (
          <AnimatedCounter value={value} decimals={decimals} suffix={suffix} />
        )}
      </span>
    </div>
  );
}
