/**
 * SettingsStatusTab — wave-181.x Phase 2 of Settings redesign.
 *
 * The "do I need to do anything?" surface. Every morning the operator
 * lands here and gets ONE clear answer: green = nothing burning, red =
 * here's what to fix and how. Replaces the wall-of-panels "ShopDriver
 * HQ" tab as the default landing.
 *
 * COMPOSITION
 *   1. KPI strip, then the pause switches as a state ("none paused" or who paused what, when)
 *   2. Open issues: severity-tagged stack with one action per row, from the gateway, impactful OFF
 *      features (never a pause switch), scheduled work (failed jobs, the data-accuracy finding in
 *      words, stuck queues, lanes not running as declared) and the cameras
 *   3. Connection health: 4 pills (ALG, F25e, VAPI, funnel)
 *   4. Scheduled work: one row per job over 24 h, failures first, skipped and clean folded
 *
 * COOL FEATURES STOLEN FROM SKILLS
 *   · task-intelligence — severity-classified alerts with one-click action
 *   · clarity-gate — "Why is this off?" inline explainer on disabled flags
 *   · observability-engineer — connection-status pill pattern
 *   · kpi-dashboard-design — KpiTile primitive (sparklines coming Phase 2.5)
 *
 * NO NEW SERVER WORK in this phase. All data comes from existing tRPC
 * queries · status is composed client-side from cached snapshots.
 */
import { Link } from "wouter";
import { useSettingsStatus, OpenIssue, SETTINGS_STATUS_CHECK_COUNT } from "./useSettingsStatus";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Phone,
  MessageSquare,
  Search,
  Wifi,
  WifiOff,
  ArrowRight,
  Sparkles,
} from "lucide-react";
// wave-181.x bug-fix · removed unused Clock import (Recent Activity
// panel was deleted due to roadmap-leak in placeholder text).
import { PageHeader, KpiTile, Panel, ErrorState } from "../shared";
import { timeAgoShort } from "../shared/format";
import type { CronHealthSummary, CronJobSummary } from "./cron-issues";
import { pauseSwitchLabel, pausedSince } from "./pauseSwitches";

// ─── Open Issue types ────────────────────────────────────

type IssueSeverity = "alert" | "warning" | "info";

const SEVERITY_STYLES: Record<IssueSeverity, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  alert: {
    bg: "bg-red-500/[0.05]",
    border: "border-red-500/30",
    text: "text-red-400",
    icon: <AlertTriangle className="w-4 h-4 text-red-400" />,
  },
  warning: {
    bg: "bg-amber-500/[0.05]",
    border: "border-amber-500/30",
    text: "text-amber-400",
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  },
  info: {
    bg: "bg-blue-500/[0.04]",
    border: "border-blue-500/25",
    text: "text-blue-400",
    icon: <Sparkles className="w-4 h-4 text-blue-400" />,
  },
};

function OpenIssueRow({ issue }: { issue: OpenIssue }) {
  const style = SEVERITY_STYLES[issue.severity];
  return (
    <div data-issue={issue.key} className={`${style.bg} ${style.border} border p-4 flex flex-wrap sm:flex-nowrap items-start gap-3`}>
      <div className="mt-0.5">{style.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-[10px] font-bold ${style.text}`}>
            {issue.severity}
          </span>
          <span className="font-semibold text-foreground text-[13px]">{issue.title}</span>
        </div>
        <p className="text-foreground/60 text-[12px] mt-1 leading-relaxed break-words">{issue.detail}</p>
        {issue.note && <p className="text-foreground/45 text-[12px] mt-1 leading-relaxed break-words">{issue.note}</p>}
        {issue.whyText && (
          <details className="mt-2 text-[11px] text-foreground/45">
            <summary className="cursor-pointer hover:text-foreground/70 transition-colors">
              Why is this open?
            </summary>
            <p className="mt-1 pl-3 border-l border-border/20 leading-relaxed">{issue.whyText}</p>
          </details>
        )}
      </div>
      {issue.actionHref && issue.actionLabel && (
        <Link
          href={issue.actionHref}
          className={`shrink-0 inline-flex min-h-[44px] items-center gap-1.5 px-3 py-1.5 ${style.text} bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-border/30 rounded text-[11px] font-semibold transition-colors`}
        >
          {issue.actionLabel}
          <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

// ─── Connection pill ─────────────────────────────────────

function ConnectionPill({
  label,
  online,
  detail,
  onlineIcon,
  offlineIcon,
}: {
  label: string;
  online: boolean | undefined;
  detail: string;
  onlineIcon?: React.ReactNode;
  offlineIcon?: React.ReactNode;
}) {
  const dot = online === true ? "bg-emerald-400" : online === false ? "bg-red-400" : "bg-foreground/30";
  const icon = online === true ? (onlineIcon ?? <Wifi className="w-3.5 h-3.5 text-emerald-400" />) : (offlineIcon ?? <WifiOff className="w-3.5 h-3.5 text-red-400" />);
  return (
    <div className="flex items-center gap-3 p-3 border border-border/20 bg-card">
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <span className="font-semibold text-foreground text-[12px]">{label}</span>
        </div>
        <p className="text-foreground/50 text-[10.5px] mt-0.5 truncate">{detail}</p>
      </div>
    </div>
  );
}

// ─── Pause switches (a state, never an issue) ────────────

type FlagRow = { key: string; value: boolean; inverted: boolean; lastChange: { by: string; at: string } | null; lastChangeKnown: boolean };

function PauseSwitchesLine({ flags, isError, onOpen }: { flags: FlagRow[] | undefined; isError: boolean; onOpen?: () => void }) {
  if (isError) {
    return (
      <p className="text-[13px] text-amber-400/90 border border-amber-500/30 bg-amber-500/[0.04] p-3">
        Pause switches could not be read; whether any lane is paused is unknown.
      </p>
    );
  }
  if (!flags) return null;
  const switches = flags.filter((f) => f.inverted);
  if (switches.length === 0) return null;
  const paused = switches.filter((f) => f.value);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full min-h-[44px] text-left border p-3 space-y-1 transition-colors hover:bg-foreground/[0.03] ${paused.length > 0 ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-border/30 bg-card"}`}
    >
      {paused.length === 0 ? (
        <span className="block text-[13px] text-foreground/70">
          Pause switches: none paused · {switches.length} switch{switches.length === 1 ? "" : "es"}
        </span>
      ) : (
        paused.map((f) => (
          <span key={f.key} className="block text-[13px] text-amber-300/90">
            Paused: {pauseSwitchLabel(f.key)} {pausedSince(f)}
          </span>
        ))
      )}
    </button>
  );
}

// ─── Scheduled work (one row per job, last 24 h) ─────────

function JobRow({ job, line }: { job: CronJobSummary; line?: string }) {
  return (
    <div data-job={job.jobName} className="min-h-[44px] py-2 border-b border-border/10 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[13px] text-foreground font-medium break-all">{job.jobName}</span>
        <span className="text-[12px] text-foreground/45">
          last run {timeAgoShort(job.lastStartedAt)} · {job.runs} run{job.runs === 1 ? "" : "s"}
        </span>
      </div>
      {line && <p className="text-[12px] text-foreground/55 mt-0.5 break-words">{line}</p>}
    </div>
  );
}

function ScheduledWorkPanel({ summary, isError, onRetry }: { summary: CronHealthSummary | undefined; isError: boolean; onRetry: () => void }) {
  const jobs = summary?.jobs ?? [];
  const failed = jobs.filter((j) => j.lastStatus === "failed");
  const skipped = jobs.filter((j) => j.lastStatus === "skipped");
  const clean = jobs.filter((j) => j.lastStatus === "completed");
  const other = jobs.filter((j) => !["failed", "skipped", "completed"].includes(j.lastStatus));
  const subtitle = summary
    ? `${failed.length} need attention · ${skipped.length} skipped by design · ${clean.length} ran clean${other.length ? ` · ${other.length} running or unknown` : ""} · last 24 h`
    : undefined;
  const fold = "min-h-[44px] flex items-center cursor-pointer text-[13px] font-semibold text-foreground/70 hover:text-foreground";

  return (
    <div id="scheduled-work">
      <Panel title="Scheduled work" subtitle={subtitle} icon={<Activity className="w-4 h-4" />}>
        {isError ? (
          <ErrorState message="Scheduled work could not be read; state unknown, not healthy." onRetry={onRetry} />
        ) : !summary ? (
          <p className="text-[13px] text-foreground/50 p-2">Scheduled work has not been read yet (offline or still loading); state unknown.</p>
        ) : jobs.length === 0 ? (
          <p className="text-[13px] text-amber-400/90 p-2">No scheduled work logged in the last 24 h. The scheduler may be down: check the server.</p>
        ) : (
          <div className="space-y-3">
            {failed.length > 0 && (
              <div className="border border-red-500/30 bg-red-500/[0.04] px-3">
                {failed.map((j) => (
                  <div key={j.jobName}>
                    <JobRow job={j} line={j.lastErrorMessage?.trim() || j.lastDetails?.trim() || "No error text was logged."} />
                    <p className="text-[12px] text-red-400 pb-2">{j.failed} of {j.runs} runs failed</p>
                  </div>
                ))}
              </div>
            )}
            {skipped.length > 0 && (
              <details>
                <summary className={fold}>Skipped ({skipped.length})</summary>
                <div className="px-3">
                  {skipped.map((j) => <JobRow key={j.jobName} job={j} line={j.lastDetails?.trim() || undefined} />)}
                </div>
              </details>
            )}
            {other.length > 0 && (
              <details>
                <summary className={fold}>Running or unknown ({other.length})</summary>
                <div className="px-3">
                  {other.map((j) => <JobRow key={j.jobName} job={j} line={`last status: ${j.lastStatus}`} />)}
                </div>
              </details>
            )}
            {clean.length > 0 && (
              <details>
                <summary className={fold}>Ran clean ({clean.length})</summary>
                <div className="px-3">
                  {clean.map((j) => <JobRow key={j.jobName} job={j} />)}
                </div>
              </details>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Main StatusTab ──────────────────────────────────────

export default function SettingsStatusTab({ onOpenPauseSwitches }: { onOpenPauseSwitches?: () => void } = {}) {
  const {
    isLoading,
    dashStats,
    algStatus,
    smsGwHealth,
    smsGwState,
    vapiStatus,
    cronSummary,
    isCronError,
    refetchCron,
    flags,
    isFlagsError,
    funnel,
    openIssues,
    alertCount,
    warningCount,
    failedChecks,

    totalCustomers,
    vipCustomers,
  } = useSettingsStatus();
  const smsGwUnknown = smsGwState === "unknown";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Activity className="w-8 h-8 text-foreground/40 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Status"
        subtitle="What needs attention today · health pulse · connection state · recent events"
        icon={<Activity className="w-5 h-5" />}
      />

      {/* ── At-a-glance KPI strip ───────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KpiTile
          label="Customers"
          value={dashStats?.shopFloor?.totalCustomers ?? "—"}
          deltaLabel={`${dashStats?.shopFloor?.vipCustomers ?? 0} VIP`}
          icon={<Users className="w-4 h-4" />}
        />
        <KpiTile
          label="Open issues"
          value={openIssues.length}
          deltaLabel={alertCount > 0 ? `${alertCount} alert${alertCount === 1 ? "" : "s"}` : warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "all clear"}
          accent={alertCount > 0 ? "danger" : warningCount > 0 ? "warning" : "success"}
          icon={alertCount > 0 ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
        />
      </div>

      <PauseSwitchesLine flags={flags as FlagRow[] | undefined} isError={isFlagsError} onOpen={onOpenPauseSwitches} />

      {/* ── Open issues stack ───────────────────────────── */}
      {openIssues.length > 0 ? (
        <Panel
          title="Open issues"
          subtitle={`${alertCount} alert${alertCount === 1 ? "" : "s"} · ${warningCount} warning${warningCount === 1 ? "" : "s"} · ordered by severity`}
          icon={<AlertTriangle className="w-4 h-4" />}
        >
          <div className="space-y-2.5">
            {openIssues.map((issue) => (
              <OpenIssueRow key={issue.key} issue={issue} />
            ))}
          </div>
        </Panel>
      ) : failedChecks.length > 0 ? (
        /* A check that could not RUN is not a check that PASSED. With every
           query down this screen used to render its greenest banner — the
           health page at maximum confidence at minimum knowledge. */
        <div className="bg-amber-500/[0.06] border border-amber-500/30 p-6 flex items-center gap-4">
          <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />
          <div>
            <h3 className="font-semibold text-foreground tracking-tight">Status unknown · {failedChecks.length} of {SETTINGS_STATUS_CHECK_COUNT} checks could not run.</h3>
            <p className="text-foreground/55 text-[12.5px] mt-0.5">
              Unreadable: {failedChecks.join(" · ")}. No news here is NOT good news: retry before trusting this page.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-500/[0.04] border border-emerald-500/25 p-6 flex items-center gap-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
          <div>
            <h3 className="font-semibold text-foreground tracking-tight">All clear.</h3>
            <p className="text-foreground/55 text-[12.5px] mt-0.5">
              No open alerts or warnings detected. Scheduled work clean · connections healthy · cameras healthy.
            </p>
          </div>
        </div>
      )}

      {failedChecks.length > 0 && openIssues.length > 0 && (
        <p className="text-[12px] text-amber-400/80">
          Note: {failedChecks.length} health check{failedChecks.length === 1 ? "" : "s"} could not run ({failedChecks.join(", ")}): the issue list above may be incomplete.
        </p>
      )}

      {/* ── Connection health ───────────────────────────── */}
      <Panel
        title="Connections"
        subtitle="Live status of the systems Nick's depends on"
        icon={<Wifi className="w-4 h-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <ConnectionPill
            label="ALG (ShopDriver)"
            online={algStatus?.connected ?? false}
            detail={algStatus?.connected ? `${algStatus.accountId || "authed"} · last check ${algStatus.lastAuthCheck ? new Date(algStatus.lastAuthCheck).toLocaleTimeString() : "just now"}` : algStatus?.error || "offline"}
            onlineIcon={<Wifi className="w-3.5 h-3.5 text-emerald-400" />}
          />
          <ConnectionPill
            label="F25e SMS gateway"
            // Q-23 phase 10 · a vendor API failure is unknown (grey), not
            // "offline · check device": nobody could ask the phone.
            online={smsGwUnknown ? undefined : smsGwHealth?.online ?? false}
            detail={smsGwUnknown ? (smsGwHealth ? "status unknown · the gateway service did not answer" : "status unknown · the status read failed") : smsGwHealth?.online ? `last seen ${smsGwHealth.ageMinutes ?? "?"}m ago` : "offline · check device"}
            onlineIcon={<MessageSquare className="w-3.5 h-3.5 text-emerald-400" />}
            offlineIcon={<MessageSquare className={`w-3.5 h-3.5 ${smsGwUnknown ? "text-foreground/40" : "text-red-400"}`} />}
          />
          <ConnectionPill
            label="VAPI receptionist"
            online={vapiStatus?.connected ?? false}
            detail={vapiStatus?.connected ? `${vapiStatus.assistants?.length ?? 0} assistant${vapiStatus.assistants?.length === 1 ? "" : "s"}` : "not configured"}
            onlineIcon={<Phone className="w-3.5 h-3.5 text-emerald-400" />}
            offlineIcon={<Phone className="w-3.5 h-3.5 text-red-400" />}
          />
          <ConnectionPill
            label="Funnel sync"
            online={(funnel?.stages?.length ?? 0) > 0}
            detail={funnel?.generatedAt ? `last update ${new Date(funnel.generatedAt).toLocaleTimeString()}` : "no data"}
            onlineIcon={<Search className="w-3.5 h-3.5 text-emerald-400" />}
            offlineIcon={<Search className="w-3.5 h-3.5 text-red-400" />}
          />
        </div>
      </Panel>

      {/* ── Scheduled work (2026-10-26) ─────────────────────
          Replaces the flat 80-run log: one row per job over 24 h, failures first,
          skipped-by-design and clean folded. A failed read says unknown. */}
      <ScheduledWorkPanel summary={cronSummary} isError={isCronError} onRetry={() => void refetchCron()} />

      {/* wave-181.x · Recent-events panel REMOVED for now.
          Placeholder roadmap text was leaking developer intent to the
          operator (CLAUDE.md red-flag: deferred TODOs displayed in
          production UI). Real activity feed lands when there's a
          unified events table to read from · see cron_alerts_fired +
          gateway events + git-tag pipeline (not yet wired). */}
    </div>
  );
}
