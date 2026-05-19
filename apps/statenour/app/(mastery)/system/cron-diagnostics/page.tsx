"use client";

/**
 * /system/cron-diagnostics — human-readable "why are my crons silent"
 * dashboard. Hits the cronDiagnostics tRPC procedure and renders the
 * prioritized diagnoses card + per-job summary table.
 *
 * Designed as the one-stop page Nour opens when he suspects stale
 * data across the OS. Shows the root cause at the top (critical
 * diagnoses first) instead of burying it under stats.
 *
 * Phase T.4 (2026-05-18 PM) · migrated from
 * `useAuthedFetch("/api/system/cron-diagnostics")` to
 * `trpc.system.cronDiagnostics.useQuery()`. Types flow from
 * `lib/system/cron-diagnostics.ts` via the system router · the
 * manual `Report`/`Diagnosis`/`JobSummary`/`KilledCron` interfaces
 * are gone (1 source of truth). Mutations stay on REST (coexistence
 * pattern) and call `utils.system.cronDiagnostics.invalidate()` to
 * trigger a React Query refetch instead of the previous manual
 * `load()` callback.
 */

import { Fragment, useCallback, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { trpc } from "@/lib/trpc/client";
import { Settings } from "lucide-react";

type Severity = "critical" | "warning" | "info";

const SEVERITY_BG: Record<Severity, string> = {
  critical: "border-rose-500/40 bg-rose-500/[0.05]",
  warning: "border-amber-500/30 bg-amber-500/[0.03]",
  info: "border-sky-500/30 bg-sky-500/[0.03]",
};
const SEVERITY_TEXT: Record<Severity, string> = {
  critical: "text-rose-300",
  warning: "text-amber-300",
  info: "text-sky-300",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "future?";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function CronDiagnosticsPage() {
  // Per-job action state: holds the jobName currently being triggered
  // or re-enabled so the UI can show a spinner on that row and block
  // double-clicks. One op at a time per page.
  const [busyJob, setBusyJob] = useState<string | null>(null);

  // Phase T.4 · React Query · types inferred from the cronDiagnostics
  // procedure · no manual Report/Diagnosis/etc mirrors to drift. The
  // previous page polled load() inside useEffect on mount only · the
  // new path keeps that behavior (no refetchInterval) and adds
  // invalidate-after-mutation for a tighter feedback loop.
  const utils = trpc.useUtils();
  const { data: report, isLoading: loading, refetch } =
    trpc.system.cronDiagnostics.useQuery(undefined, { staleTime: 30_000 });
  const load = useCallback(() => void refetch(), [refetch]);
  const invalidate = useCallback(
    () => utils.system.cronDiagnostics.invalidate(),
    [utils],
  );

  // Phase NN (2026-05-19 AM) · close the T.4 coexistence carve-out.
  // Pre-fix `runNow` sent `{jobName}` to a REST route that expected
  // `{path}` · button was silently broken since wave-181.4. The new
  // tRPC mutation `system.runCron({jobName})` derives the path
  // server-side · same typed shape both transports + same drift-proof
  // catalog lookup. `enableCron` migrated alongside for symmetry.
  const runCronMutation = trpc.system.runCron.useMutation();
  const setCronEnabledMutation = trpc.system.setCronEnabled.useMutation();

  /** Fire a cron manually · derives path from jobName server-side. */
  const runNow = useCallback(
    async (jobName: string) => {
      setBusyJob(jobName);
      try {
        const result = await runCronMutation.mutateAsync({ jobName });
        if (result.ok === false) {
          toast.error(`${jobName} failed: ${result.error ?? result.status ?? "unknown"}`);
        } else {
          toast.success(`${jobName} ran · ${result.durationMs ?? "?"}ms`);
        }
        await invalidate();
      } catch (e) {
        toast.error(`trigger failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusyJob(null);
      }
    },
    [invalidate, runCronMutation],
  );

  /** Flip a cron's enabled flag back to true. */
  const enableCron = useCallback(
    async (jobName: string) => {
      setBusyJob(jobName);
      try {
        await setCronEnabledMutation.mutateAsync({ jobName, enabled: true });
        toast.success(`${jobName} re-enabled`);
        await invalidate();
      } catch (e) {
        toast.error(`enable failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusyJob(null);
      }
    },
    [invalidate, setCronEnabledMutation],
  );

  const criticalCount = report?.diagnoses.filter((d) => d.severity === "critical").length ?? 0;
  const warningCount = report?.diagnoses.filter((d) => d.severity === "warning").length ?? 0;

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="cron diagnostics"
      description={
        report
          ? `${report.summary.declaredActiveCrons} declared · ${report.summary.jobsWithLogsLast48h} logged · ${criticalCount} critical · ${warningCount} warnings`
          : "probing…"
      }
      width="xl"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          {/* v10.0.80 · cross-link to sister cron pages (control + run history) */}
          <Link
            href="/system/crons"
            className="hidden md:flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-white/[0.06] hover:text-zinc-100"
            title="Live control deck — toggle / run-now / kill switch"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>control →</span>
          </Link>
          {/* v10.0.305 · runs cross-link removed · /system/cron-runs
              index deleted · /system/crons (control deck above) covers
              that view. Detail drill-down /cron-runs/[jobName] still
              works via the per-job table rows below. */}
          <FreshnessChip
            lastFetchedAt={report?.checkedAt}
            source="db · CronJobLog"
            onReload={load}
          />
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
          >
            {loading ? "probing…" : "re-scan"}
          </button>
        </div>
      }
    >

      {/* ── Top-level summary grid ─────────────────────────────────── */}
      {report && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryCell
              label="declared active"
              value={report.summary.declaredActiveCrons}
              tint="text-white"
            />
            <SummaryCell
              label="logged (48h)"
              value={report.summary.jobsWithLogsLast48h}
              tint={report.summary.jobsWithLogsLast48h > 0 ? "text-emerald-400" : "text-rose-400"}
            />
            <SummaryCell
              label="silent"
              value={report.summary.silentDeclaredCrons}
              tint={report.summary.silentDeclaredCrons > 0 ? "text-amber-400 animate-pulse" : "text-zinc-500"}
            />
            <SummaryCell
              label="killed manually"
              value={report.summary.killedIndividually}
              tint={report.summary.killedIndividually > 0 ? "text-rose-400" : "text-zinc-500"}
            />
            <SummaryCell
              label="log rows (48h)"
              value={report.summary.totalLogRowsLast48h}
              tint={report.summary.totalLogRowsLast48h > 0 ? "text-emerald-400" : "text-rose-400 animate-pulse"}
            />
            <FlagCell
              label="CRON_SECRET"
              ok={report.summary.cronSecretPresent}
            />
            <FlagCell
              label="Google OAuth"
              ok={report.summary.googleOauthConfigured}
              brokenHint="ingest-drive/gmail/calendar silently skip without this"
            />
            <FlagCell
              label="paused all"
              ok={!report.summary.pauseAllCrons}
              inverted
            />
          </div>
        </Panel>
      )}

      {/* ── Diagnoses (critical first) ─────────────────────────────── */}
      {report?.diagnoses.map((d, i) => (
        <Panel
          key={i}
          className={cn("border", SEVERITY_BG[d.severity])}
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase tracking-wider",
                d.severity === "critical" && "bg-rose-500/20 text-rose-200",
                d.severity === "warning" && "bg-amber-500/20 text-amber-200",
                d.severity === "info" && "bg-sky-500/20 text-sky-200",
              )}
            >
              {d.severity === "critical" ? "!" : d.severity === "warning" ? "⚠" : "i"}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className={cn("text-sm font-semibold", SEVERITY_TEXT[d.severity])}>
                {d.headline}
              </h3>
              <p className="text-[11px] leading-relaxed text-zinc-300">
                {d.detail}
              </p>
              <div className="mt-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.03] p-2">
                <span className="mr-2 font-mono text-[9px] uppercase tracking-wider text-emerald-400">
                  fix →
                </span>
                <span className="text-[11px] text-zinc-200">{d.fix}</span>
              </div>
            </div>
          </div>
        </Panel>
      ))}

      {/* ── Silent crons list ──────────────────────────────────────── */}
      {report && report.silentDeclaredCrons.length > 0 && (
        <Panel className="border-amber-500/20 bg-amber-500/[0.02]">
          <h2 className="mb-2 text-sm font-semibold text-amber-300">
            silent crons · declared but no logs in 48h
          </h2>
          <div className="flex flex-wrap gap-2">
            {report.silentDeclaredCrons.map((name) => (
              <span
                key={name}
                className="rounded-full border border-amber-500/30 bg-amber-500/[0.05] px-2 py-1 text-[10px] font-mono text-amber-200"
              >
                {name}
              </span>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Killed individually ────────────────────────────────────── */}
      {report && report.killedIndividually.length > 0 && (
        <Panel className="border-rose-500/20 bg-rose-500/[0.02]">
          <h2 className="mb-2 text-sm font-semibold text-rose-300">
            individually killed · one-click re-enable
          </h2>
          <div className="space-y-1">
            {report.killedIndividually.map((c) => (
              <div
                key={c.jobName}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded bg-rose-500/[0.03] px-2 py-1.5 text-[11px]"
              >
                <div className="min-w-0">
                  <span className="font-mono text-rose-200">{c.jobName}</span>
                  {c.note && (
                    <span className="ml-2 text-zinc-500">· {c.note}</span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-zinc-500">
                  killed {timeAgo(c.updatedAt)}
                </span>
                <button
                  onClick={() => enableCron(c.jobName)}
                  disabled={busyJob !== null}
                  className={cn(
                    "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50",
                    busyJob === c.jobName && "animate-pulse",
                  )}
                >
                  {busyJob === c.jobName ? "enabling…" : "enable"}
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Per-job summary (active ones) ──────────────────────────── */}
      {report && report.jobSummaries.length > 0 && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <h2 className="mb-3 text-sm font-semibold text-white">
            per-job log summary · last 48h
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  <th className="px-2 py-1 text-left font-normal">job</th>
                  <th className="px-2 py-1 text-right font-normal">success</th>
                  <th className="px-2 py-1 text-right font-normal">failed</th>
                  <th className="px-2 py-1 text-right font-normal">last success</th>
                  <th className="px-2 py-1 text-right font-normal">last fail</th>
                  <th className="px-2 py-1 text-right font-normal">run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {report.jobSummaries.map((j) => (
                  <Fragment key={j.jobName}>
                    <tr className="hover:bg-white/[0.02]">
                      <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-200">
                        <a
                          href={`/system/cron-runs/${encodeURIComponent(j.jobName)}`}
                          className="hover:text-sky-300 hover:underline underline-offset-2"
                          title={`Open run history for ${j.jobName}`}
                        >
                          {j.jobName}
                        </a>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-emerald-400">
                        <AnimatedCounter value={j.success48h} />
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-[11px] tabular-nums",
                          j.fail48h > 0 ? "text-rose-400" : "text-zinc-700",
                        )}
                      >
                        <AnimatedCounter value={j.fail48h} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[10px] text-zinc-500">
                        {timeAgo(j.lastSuccessAt)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono text-[10px]",
                          j.lastFailAt ? "text-rose-400" : "text-zinc-700",
                        )}
                      >
                        {j.lastFailAt ? timeAgo(j.lastFailAt) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => runNow(j.jobName)}
                          disabled={busyJob !== null}
                          className={cn(
                            "rounded-md border border-sky-500/40 bg-sky-500/[0.08] px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-40",
                            busyJob === j.jobName && "animate-pulse",
                          )}
                        >
                          {busyJob === j.jobName ? "…" : "run now"}
                        </button>
                      </td>
                    </tr>
                    {/* When a job has a lastError, show it as a sub-row
                         inline so the error message is visible without
                         needing to click into /system/errors separately. */}
                    {j.lastError && (
                      <tr className="bg-rose-500/[0.02]">
                        <td
                          colSpan={6}
                          className="px-2 pb-1.5 pt-0.5 font-mono text-[9px] italic text-rose-400/80"
                          title={j.lastError}
                        >
                          ↳ {j.lastError.slice(0, 180)}
                          {j.lastError.length > 180 ? "…" : ""}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        scanner: lib/system/stale-data-scanner.ts · DB reads only ·
        safe to re-run anytime
      </p>
    </StandardPage>
  );
}

function SummaryCell({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--bg-raised)]/[0.03] p-3">
      <div className={cn("text-2xl font-bold tabular-nums", tint)}>
        <AnimatedCounter value={value} />
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}

function FlagCell({
  label,
  ok,
  inverted,
  brokenHint,
}: {
  label: string;
  ok: boolean;
  inverted?: boolean;
  brokenHint?: string;
}) {
  const displayOk = inverted ? ok : ok;
  return (
    <div
      className={cn(
        "rounded-lg p-3",
        displayOk
          ? "bg-emerald-500/[0.04]"
          : "bg-rose-500/[0.06] ring-1 ring-rose-500/20",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            displayOk ? "bg-emerald-400" : "bg-rose-400 animate-pulse",
          )}
        />
        <div
          className={cn(
            "text-xs font-semibold",
            displayOk ? "text-emerald-300" : "text-rose-300",
          )}
        >
          {displayOk ? "✓" : "✗"} {label}
        </div>
      </div>
      {!displayOk && brokenHint && (
        <div className="mt-1 text-[9px] leading-tight text-rose-300/70">
          {brokenHint}
        </div>
      )}
    </div>
  );
}
