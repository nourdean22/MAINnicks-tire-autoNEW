"use client";

/**
 * /system/health — OS health dashboard.
 *
 * Renders the system health snapshot as a real UI. Groups signals
 * into 5 tiles:
 *   1. Cron Health — per-job success/fail ratio + duration
 *   2. Error Patterns — grouped + counted, top-5 repeats
 *   3. Backlog Pressure — captures · commitments · inbox tasks · drift
 *   4. Freshness — last score · dump · reflection · capture
 *   5. Vector Coverage — embedding rows per source type
 *
 * Range selector (24h / 7d / 30d) reshapes the cron + error slices.
 * Auto-refreshes every 2 minutes via React Query's refetchInterval.
 *
 * Phase S.3 (2026-05-18 PM) · migrated from
 * `useAuthedFetch("/api/system/health-report?range=X")` to
 * `trpc.system.healthReport.useQuery({ range })`. Types now flow
 * from `lib/services/system-health.ts` via the system router · no
 * manual HealthReport mirror to drift. The legacy REST endpoint
 * stays mounted for back-compat.
 */

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/ui";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  Activity,
  Flame,
  Archive,
} from "lucide-react";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { TrendCounter } from "@/components/ui/trend-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { SchemaDriftCard } from "@/components/system/schema-drift-card";
import { trpc } from "@/lib/trpc/client";
import type { HealthReport } from "@/lib/services/system-health";

export default function SystemHealthPage() {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");

  // Phase S.3 · React Query handles the 2-min refresh + per-range
  // refetch automatically when `range` changes (it's part of the
  // input key). Stale-while-revalidate avoids the prior "blank flash
  // on range switch" the manual setState path had.
  const { data, isLoading, refetch } = trpc.system.healthReport.useQuery(
    { range },
    {
      refetchInterval: 120_000,
      staleTime: 60_000,
    },
  );
  const load = () => void refetch();

  if (isLoading && !data) {
    return (
      <main className="max-w-4xl mx-auto px-3 py-4">
        <ShimmerSkeleton className="h-10 rounded" />
      </main>
    );
  }
  if (!data) {
    return (
      <main className="max-w-4xl mx-auto px-3 py-4">
        <p className="text-[var(--text-tertiary)]">health-report unavailable</p>
      </main>
    );
  }

  const totalVectors = data.vectorIndex.reduce((s, v) => s + v.count, 0);
  const cronFailureRate = data.cron.totalLogs
    ? Math.round((data.cron.failureCount / data.cron.totalLogs) * 100)
    : 0;
  // error_logs stores error | warn | fatal in one table and the tile
  // counted all three as "errors". Split them so a wall of warnings
  // stops reading as a wall of failures.
  const realErrorCount = data.errors.byLevel
    .filter((l) => l.level === "error" || l.level === "fatal")
    .reduce((s, l) => s + l.count, 0);
  const warnCount = data.errors.byLevel
    .filter((l) => l.level === "warn")
    .reduce((s, l) => s + l.count, 0);
  const errorLevelSplit =
    warnCount > 0 ? `${realErrorCount} err / ${warnCount} warn` : "";
  // Only the components that actually reported. A null drift read is
  // surfaced in the label as "?" rather than silently summed as 0.
  const knownBacklog =
    data.backlog.inboxTasks +
    data.backlog.activeCommitments +
    data.backlog.activeCaptures +
    (data.backlog.unackedDriftAlerts ?? 0);

  return (
    <main className="max-w-4xl mx-auto px-3 py-4 space-y-4">
      {/* Header */}
      <PageHeader
        parentHref="/system"
        parentLabel="system"
        eyebrow="System"
        title="os health"
        description="Provider, database, cron + integration health at a glance."
        actions={
          <div className="flex items-center gap-2">
            <FreshnessChip
              lastFetchedAt={data.generatedAt}
              source="health-report"
              onReload={load}
            />
            <div className="inline-flex rounded-md border border-[var(--border-default)] overflow-hidden">
              {(["24h", "7d", "30d"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    "px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors",
                    range === r
                      ? "bg-[var(--gold)]/15 text-[var(--gold)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              onClick={load}
              className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--bg-raised)]"
              aria-label="refresh"
              title="refresh"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        }
      />

      {/* 2026-05-29 · "What's broken now" — operational rollup (AI eval
          pass-rate + nickstire bridge / data-source probes). The two
          dimensions that broke in prod (revenue $0 · evals 0/75 · bridge
          down) but weren't surfaced here. Loud (red) only when wrong. */}
      <OperationalStatus report={data} />

      {/* v8.2 BATCH 12 — schema-drift sentinel surface. Loud only when
          something's off; silent (✓ all expectations met) otherwise. */}
      <SchemaDriftCard />

      {/* v10.0.222 · TrendCounter row · cron + errors carry their own
          prior-window baseline (`data.previous`), so the operator reads
          'errors 12 (↓ -33% vs prior 7d)' instead of bare '12'. Backlog
          + vectors don't have natural baselines yet (they're a state
          snapshot, not a time-series), so they read as plain values
          with neutral tone. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <TrendCounter
          value={data.cron.totalLogs}
          baseline={data.previous?.cronTotal ?? null}
          baselineLabel={`vs prior ${data.range}`}
          label={
            data.cron.totalLogs === 0
              ? "cron ops · NO RUNS LOGGED"
              : data.cron.failureCount > 0 || data.cron.partialCount > 0
                ? `cron ops · ${cronFailureRate}% fail${
                    data.cron.partialCount > 0 ? ` · ${data.cron.partialCount} partial` : ""
                  }`
                : "cron ops · all green"
          }
          goodWhen="neutral"
          // Zero rows is the most common cron failure mode (a dead fleet
          // logs nothing) and used to render "all green" in emerald.
          // A single failure and five hundred also painted identically —
          // there was no rose tier here, unlike the errors tile.
          tone={
            data.cron.totalLogs === 0 ? "rose"
            : cronFailureRate >= 10 ? "rose"
            : data.cron.failureCount > 0 || data.cron.partialCount > 0 ? "amber"
            : "emerald"
          }
        />
        <TrendCounter
          value={data.errors.total}
          baseline={data.previous?.errorTotal ?? null}
          baselineLabel={`vs prior ${data.range}`}
          // `topPatterns.length` is slice(0,5)-capped, so this label read
          // "5 patterns" for any window with ≥5 distinct messages — it
          // could never print 6, and reported the cap as a measurement.
          label={
            data.errors.distinctPatterns > 0
              ? `errors · ${data.errors.distinctPatterns} patterns${
                  errorLevelSplit ? ` · ${errorLevelSplit}` : ""
                }`
              : "errors · quiet"
          }
          goodWhen="low"
          // Tone follows error+fatal, not the raw total: warns have run
          // ~68% of this table, which pinned the tile permanently rose.
          tone={
            realErrorCount > 100 ? "rose"
            : realErrorCount > 0 ? "amber"
            : "emerald"
          }
        />
        <TrendCounter
          value={knownBacklog}
          // `unackedDriftAlerts ?? 0` folded a FAILED READ into the sum as
          // zero — re-committing in the headline the exact fabricated
          // all-clear that system-health.ts:161-163 refuses to produce and
          // that the detail row below renders honestly as "?".
          label={`backlog · ${data.backlog.inboxTasks}t · ${data.backlog.activeCommitments}c · ${data.backlog.activeCaptures}cap${
            data.backlog.unackedDriftAlerts === null
              ? " · drift ?"
              : ` · ${data.backlog.unackedDriftAlerts}d`
          }`}
          goodWhen="low"
          tone={data.backlog.unackedDriftAlerts === null ? "amber" : "tertiary"}
        />
        <TrendCounter
          value={totalVectors}
          // Lifetime total (groupBy has no `where`), sitting in a row where
          // every neighbour is {range}-scoped. Say so, so a number that
          // only ever climbs isn't read as in-window activity.
          label={`vectors · ${data.vectorIndex.length} sources · all-time`}
          goodWhen="high"
          tone="tertiary"
        />
      </div>

      {/* Cron health table */}
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
          <Activity size={12} className="text-[var(--gold)]" />
          <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
            cron health · {data.range}
          </h2>
          <span className="text-[9px] font-mono text-[var(--text-tertiary)] ml-auto">
            {data.cron.jobs.length} jobs reported
          </span>
        </header>
        {data.cron.jobs.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-[var(--text-tertiary)] italic">
            No cron logs in {data.range} — crons may be idle in this window. Check{" "}
            <Link href="/system/crons" className="underline underline-offset-2 hover:text-[var(--gold)]">/system/crons</Link>{" "}
            for the live control deck.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                <th className="text-left px-3 py-1 font-normal">job</th>
                <th className="text-right px-3 py-1 font-normal">success</th>
                <th className="text-right px-3 py-1 font-normal">failed</th>
                <th className="text-right px-3 py-1 font-normal">avg ms</th>
                <th className="text-right px-3 py-1 font-normal">status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]/40">
              {[...data.cron.jobs]
                .sort((a, b) => b.failed - a.failed || b.success - a.success)
                .map((j) => (
                  <tr key={j.jobName} className="hover:bg-[var(--bg-void)]/40">
                    <td className="px-3 py-1.5 text-[11px] font-mono text-[var(--text-primary)]">{j.jobName}</td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-emerald-400 text-right"><AnimatedCounter value={j.success} /></td>
                    <td className={cn("px-3 py-1.5 text-[11px] font-mono tabular-nums text-right", j.failed > 0 ? "text-red-400" : "text-[var(--text-tertiary)]")}>
                      <AnimatedCounter value={j.failed} />
                    </td>
                    <td className="px-3 py-1.5 text-[11px] font-mono tabular-nums text-[var(--text-tertiary)] text-right"><AnimatedCounter value={j.avgMs} /></td>
                    <td className="px-3 py-1.5 text-right">
                      {j.healthy ? (
                        <CheckCircle2 size={11} className="inline text-emerald-400" />
                      ) : (
                        <AlertTriangle size={11} className="inline text-red-400" />
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Error patterns */}
      {data.errors.topPatterns.length > 0 && (
        <section className="rounded-lg border border-red-500/30 bg-red-500/5">
          <header className="flex items-center gap-2 px-3 py-2 border-b border-red-500/20">
            <AlertTriangle size={12} className="text-red-400" />
            <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-red-400">
              top error patterns · {data.range}
            </h2>
          </header>
          <ul className="divide-y divide-red-500/10">
            {data.errors.topPatterns.map((p, i) => (
              <li key={i} className="px-3 py-1.5 flex items-center gap-3">
                <span className="shrink-0 text-[9px] font-mono font-bold tabular-nums text-red-400 w-6 text-right">
                  ×<AnimatedCounter value={p.count} />
                </span>
                <span className="text-[11px] font-mono text-[var(--text-primary)] min-w-0 truncate">{p.msg}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Freshness grid */}
      <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
          <Clock size={12} className="text-blue-400" />
          <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-blue-400">
            signal freshness
          </h2>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border-default)]/40">
          {/* Apr 19 · DailyScore tile retired (scorer killed).
              Replaced with Identity Refresh + Skill Extraction so this
              row tracks the brain-learning crons instead. */}
          <FreshnessTile label="brain dump" hoursAgo={data.freshness.lastBrainDumpHoursAgo} />
          <FreshnessTile label="reflection" hoursAgo={data.freshness.lastReflectionHoursAgo} />
          <FreshnessTile label="capture" hoursAgo={data.freshness.lastCaptureHoursAgo} />
          <FreshnessTile
            label="identity refresh"
            hoursAgo={data.freshness.lastIdentityRefreshHoursAgo ?? null}
          />
        </div>
      </section>

      {/* Backlog + Vector tiles side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]">
          <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
            <Archive size={12} className="text-amber-400" />
            <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-amber-400">
              backlog pressure
            </h2>
          </header>
          <dl className="p-3 space-y-1.5 text-[11px] font-mono">
            {/* Apr 18: /commitments /drift /capture pages retired — all
                flow into the unified /tasks surface now. */}
            <KVRow k="inbox tasks" v={data.backlog.inboxTasks} href="/missions" />
            <KVRow k="active commitments" v={data.backlog.activeCommitments} href="/missions" />
            <KVRow k="active captures" v={data.backlog.activeCaptures} href="/missions" />
            {/* null = the drift read failed — "?" with warn tone, never a clean 0 */}
            <KVRow k="unacked drift" v={data.backlog.unackedDriftAlerts ?? "?"} href="/" tone={data.backlog.unackedDriftAlerts === null || data.backlog.unackedDriftAlerts > 3 ? "warn" : undefined} />
          </dl>
        </section>

        <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]">
          <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
            <Database size={12} className="text-violet-400" />
            <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-violet-400">
              vector coverage
            </h2>
            <span className="text-[9px] font-mono text-[var(--text-tertiary)] ml-auto"><AnimatedCounter value={totalVectors} /> rows</span>
          </header>
          <dl className="p-3 space-y-1.5 text-[11px] font-mono">
            {data.vectorIndex.length === 0 ? (
              <p className="italic text-[var(--text-tertiary)]">no vector rows</p>
            ) : (
              data.vectorIndex
                .sort((a, b) => b.count - a.count)
                .map((v) => <KVRow key={v.sourceType} k={v.sourceType} v={v.count} />)
            )}
          </dl>
        </section>
      </div>

      {/* Law feedback */}
      {(data.lawFeedback.situationLogsWithLawId > 0 || data.lawFeedback.triggerContextLogs > 0) && (
        <section className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/5">
          <header className="flex items-center gap-2 px-3 py-2">
            <Flame size={12} className="text-[var(--gold)]" />
            <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-[var(--gold)]">
              strategic law feedback · {data.range}
            </h2>
            <span className="text-[9px] font-mono text-[var(--text-tertiary)] ml-auto">
              {data.lawFeedback.situationLogsWithLawId} logged · {data.lawFeedback.triggerContextLogs} via trigger
            </span>
          </header>
        </section>
      )}

      {/* v10.0.275 · Strategic-frameworks lens-firing summary
          Surfaces the top-fired lenses + fallback rate alongside the
          rest of system health. Click-through to /system/lens-stats
          for window selector + full per-surface breakdown. */}
      {/* `lens === null` means the READ THREW — system-health.ts:220-224
          returns null precisely so a failed query stops rendering
          byte-identically to a healthy-but-quiet lens. Hiding the section
          on null threw that distinction away again at the consumer. */}
      {data.lens === null && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <span className="text-[10px] font-mono text-amber-300">
            strategic lens · read failed — unknown, not zero
          </span>
        </section>
      )}
      {data.lens && data.lens.totalFires > 0 && (
        <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5">
          <header className="flex items-center gap-2 px-3 py-2">
            <Activity size={12} className="text-emerald-400" />
            <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-emerald-300">
              strategic lens · {data.range}
            </h2>
            <Link
              href="/system/calibration"
              className="ml-auto text-[9px] font-mono text-emerald-400/80 hover:text-emerald-300"
            >
              full →
            </Link>
          </header>
          <dl className="px-3 pb-2 text-[11px] font-mono space-y-0.5">
            <KVRow
              k="total fires"
              v={data.lens.totalFires}
            />
            <KVRow
              k="fallback rate"
              v={`${data.lens.fallbackRate}%`}
              tone={data.lens.fallbackRate > 30 ? "warn" : "ok"}
            />
            {data.lens.top.slice(0, 3).map((t) => (
              <KVRow key={t.framework} k={t.framework} v={t.count} />
            ))}
          </dl>
        </section>
      )}

      {/* v10.0.275 · VAPI voice-call summary
          Shows how many calls Nick handled in the window + spend +
          avg duration. Click-through to /system/vapi-calls for
          per-call detail. */}
      {data.voice && data.voice.totalCalls > 0 && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/5">
          <header className="flex items-center gap-2 px-3 py-2">
            <Activity size={12} className="text-amber-400" />
            <h2 className="text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em] text-amber-300">
              voice calls (VAPI) · {data.range}
            </h2>
          </header>
          <dl className="px-3 pb-2 text-[11px] font-mono space-y-0.5">
            <KVRow k="calls" v={data.voice.totalCalls} />
            <KVRow k="avg duration" v={`${data.voice.avgDurationSec}s`} />
            <KVRow k="spend" v={`$${data.voice.totalCostUsd.toFixed(2)}`} />
          </dl>
        </section>
      )}
    </main>
  );
}

/**
 * The banner used to compute `allGood` from the eval pass-rate and the
 * data-source probes ALONE. Cron failures and error volume — the two
 * loudest numbers on the page — could not turn it red, so it rendered
 * "ALL CLEAR" above 1,423 errors and a 2% cron failure rate.
 *
 * Two further holes made the remaining inputs unable to fire:
 *   · `evalBad` required `ev !== null && ev.total > 0`. eval_result has
 *     had NO PRODUCER since the nightly harness was deleted, so `ev` is
 *     permanently null and the eval input was inert by construction.
 *   · `ds.total === 0` (zero probe rows) rendered "no probes yet" while
 *     `failing > 0` stayed false — no probes read as all-clear.
 *
 * Green now requires a live instrument that actually reported. Anything
 * unproven degrades to amber rather than passing as healthy.
 */
function OperationalStatus({ report }: { report: HealthReport }) {
  const op = report.operational;
  const ev = op.eval;
  const evalBad = ev !== null && ev.total > 0 && ev.passRate < 70;
  // No FRESH eval run is not evidence of health — it is absence of
  // evidence. It degrades, it does not clear.
  const evalUnknown = ev === null || ev.total === 0;
  const ds = op.dataSources;
  // ds === null means the probe READ failed — unknown never counts as
  // all-clear (fleet-truth pattern, 2026-07-30 sweep).
  const dsUnknown = ds === null || ds.total === 0;
  const dsBad = ds !== null && ds.failing > 0;
  // A canary nobody has fed in 48h is not a green canary.
  const dsStale = ds !== null && ds.stale > 0;

  const hardCronFailures = report.cron.failureCount;
  const cronFailRate = report.cron.totalLogs
    ? (hardCronFailures / report.cron.totalLogs) * 100
    : 0;
  // Zero rows in the window = the fleet is silent, the most common cron
  // failure mode. The tile already goes rose for it; without this the
  // banner stayed green for up to 48h (until probe staleness caught it
  // transitively) while the tile below screamed.
  const cronSilent = report.cron.totalLogs === 0;
  // Errors counted at level error/fatal only — `total` includes warns,
  // which historically ran ~68% of the table and pinned the tile red.
  const realErrors = report.errors.byLevel
    .filter((l) => l.level === "error" || l.level === "fatal")
    .reduce((s, l) => s + l.count, 0);

  const down = evalBad || dsBad || cronFailRate >= 10;
  const degraded =
    !down &&
    (dsUnknown ||
      dsStale ||
      evalUnknown ||
      cronSilent ||
      hardCronFailures > 0 ||
      realErrors > 100);
  const allGood = !down && !degraded;

  const headline = down
    ? "operational · needs attention"
    : degraded
      ? "operational · degraded"
      : "operational · all clear";
  // Why it is not green — the operator should never have to guess.
  const reasons: string[] = [];
  if (dsBad) reasons.push(`${ds!.failing} data source${ds!.failing > 1 ? "s" : ""} failing`);
  if (evalBad) reasons.push(`eval pass-rate ${ev!.passRate}%`);
  if (cronFailRate >= 10) reasons.push(`cron failing ${Math.round(cronFailRate)}%`);
  if (ds === null) reasons.push("probe read failed");
  else if (ds.total === 0) reasons.push("no probes have run");
  if (dsStale) reasons.push(`${ds!.stale} probe${ds!.stale > 1 ? "s" : ""} stale >48h`);
  if (evalUnknown) reasons.push("no eval run in 7d");
  if (cronSilent) reasons.push(`no cron runs logged in ${report.range}`);
  if (!down && hardCronFailures > 0) reasons.push(`${hardCronFailures} cron failures`);
  if (realErrors > 100) reasons.push(`${realErrors} errors`);

  return (
    <section
      className={cn(
        "rounded-lg border px-3 py-2.5",
        allGood
          ? "border-emerald-500/30 bg-emerald-500/5"
          : down
            ? "border-red-500/40 bg-red-500/[0.07]"
            : "border-amber-500/40 bg-amber-500/[0.07]",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {allGood ? (
          <CheckCircle2 size={12} className="text-emerald-400" />
        ) : (
          <AlertTriangle size={12} className={down ? "text-red-400" : "text-amber-400"} />
        )}
        <h2
          className={cn(
            "text-[10px] font-[var(--font-display)] font-bold uppercase tracking-[0.22em]",
            allGood ? "text-emerald-300" : down ? "text-red-400" : "text-amber-300",
          )}
        >
          {headline}
        </h2>
      </div>
      {reasons.length > 0 && (
        <p className="mb-2 text-[10px] font-mono text-[var(--text-secondary)]">
          {reasons.join(" · ")}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Link
          href="/system/calibration"
          className="block rounded-md border border-[var(--border-default)] px-3 py-2 hover:bg-[var(--bg-void)]/30"
        >
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
              AI eval pass-rate
            </span>
            <span className="text-[9px] font-mono text-[var(--text-tertiary)]/70">
              calibration →
            </span>
          </div>
          {ev && ev.total > 0 ? (
            <div
              className={cn(
                "text-sm font-bold tabular-nums",
                evalBad ? "text-red-400" : "text-emerald-400",
              )}
            >
              {ev.passRate}%
              <span className="ml-2 text-[10px] font-mono text-[var(--text-tertiary)]">
                {ev.passed}/{ev.total}
              </span>
            </div>
          ) : (
            <div className="text-sm text-[var(--text-tertiary)]">no eval run yet</div>
          )}
        </Link>
        <div className="block rounded-md border border-[var(--border-default)] px-3 py-2">
          {/* Label said "bridge · data sources" but the number counts ALL
              probes regardless of kind — only 2 of the 6 are the nickstire
              bridge, and `bridgeFailing` was computed and never rendered. */}
          <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
            data-source probes
          </div>
          <div
            className={cn(
              "text-sm font-bold tabular-nums",
              dsBad ? "text-red-400" : dsUnknown || dsStale ? "text-amber-400" : "text-emerald-400",
            )}
          >
            {ds === null
              ? "probe read failed — unknown"
              : ds.total === 0
                ? "no probes have run"
                : dsBad
                  ? `${ds.failing} of ${ds.total} failing`
                  : dsStale
                    ? `${ds.stale} of ${ds.total} stale`
                    : `${ds.total} OK`}
          </div>
          {ds !== null && ds.bridgeFailing > 0 && (
            <div className="text-[9px] font-mono text-red-300/90 mt-0.5">
              {ds.bridgeFailing} nickstire bridge
            </div>
          )}
        </div>
      </div>
      {ds !== null && (dsBad || dsStale) && (
        <ul className="mt-2 space-y-0.5">
          {ds.probes
            .filter((p) => !p.ok || p.stale)
            .slice(0, 6)
            .map((p) => (
              <li
                key={p.name}
                className={cn(
                  "text-[10px] font-mono truncate",
                  p.ok ? "text-amber-300/90" : "text-red-300/90",
                )}
              >
                {p.name}: {p.reason ?? (p.ok ? "stale" : "failing")}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function FreshnessTile({
  label,
  hoursAgo,
  extra,
}: {
  label: string;
  hoursAgo: number | null;
  extra?: string;
}) {
  let text = "never";
  let color = "text-[var(--text-tertiary)]";
  if (hoursAgo !== null) {
    if (hoursAgo < 24) {
      text = `${hoursAgo}h ago`;
      color = "text-emerald-400";
    } else {
      const days = Math.round(hoursAgo / 24);
      text = `${days}d ago`;
      color = days <= 3 ? "text-[var(--text-secondary)]" : days <= 7 ? "text-amber-400" : "text-red-400";
    }
  }
  return (
    <div className="bg-[var(--bg-raised)] px-3 py-2">
      <div className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
        {label}
      </div>
      <div className={cn("text-sm font-[var(--font-display)] font-bold tabular-nums", color)}>
        {text}
      </div>
      {extra && <div className="text-[8px] font-mono text-[var(--text-tertiary)]/80">{extra}</div>}
    </div>
  );
}

function KVRow({
  k,
  v,
  href,
  tone,
}: {
  k: string;
  v: number | string;
  href?: string;
  /** v10.0.275 · 'ok' for healthy emerald tint · 'warn' for amber */
  tone?: "warn" | "ok";
}) {
  const color =
    tone === "warn"
      ? "text-amber-400"
      : tone === "ok"
        ? "text-emerald-300"
        : "text-[var(--text-primary)]";
  const body = (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text-secondary)]">{k}</span>
      <span className={cn("tabular-nums font-bold", color)}>
        {typeof v === "number" ? <AnimatedCounter value={v} /> : v}
      </span>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block hover:bg-[var(--bg-void)]/30 -mx-1 px-1 py-0.5 rounded">
        {body}
      </Link>
    );
  }
  return body;
}
