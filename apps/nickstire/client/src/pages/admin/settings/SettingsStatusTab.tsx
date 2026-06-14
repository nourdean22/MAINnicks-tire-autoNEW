/**
 * SettingsStatusTab — wave-181.x Phase 2 of Settings redesign.
 *
 * The "do I need to do anything?" surface. Every morning the operator
 * lands here and gets ONE clear answer: green = nothing burning, red =
 * here's what to fix and how. Replaces the wall-of-panels "ShopDriver
 * HQ" tab as the default landing.
 *
 * COMPOSITION
 *   1. KPI strip — today / week / month at a glance (4 tiles)
 *   2. Open issues — severity-tagged stack with one-click action per row
 *      · sourced from:
 *        - feature flags currently OFF that have impact
 *        - bleeding SEO pages (high impr, low CTR)
 *        - gateway/integration disconnects
 *        - missed-followup buckets
 *   3. Connection health — 4 dots (ALG, F25e, VAPI, DB)
 *   4. Recent events — last 24h of deploys + alerts (placeholder feed)
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
import { useSettingsStatus, OpenIssue } from "./useSettingsStatus";
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
import { PageHeader, KpiTile, Panel } from "../shared";

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
    <div className={`${style.bg} ${style.border} border p-4 flex items-start gap-3`}>
      <div className="mt-0.5">{style.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-[10px] font-bold tracking-[0.15em] uppercase ${style.text}`}>
            {issue.severity}
          </span>
          <span className="font-semibold text-foreground text-[13px]">{issue.title}</span>
        </div>
        <p className="text-foreground/60 text-[12px] mt-1 leading-relaxed">{issue.detail}</p>
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
          className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 ${style.text} bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-border/30 rounded text-[11px] font-semibold transition-colors`}
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

// ─── Main StatusTab ──────────────────────────────────────

export default function SettingsStatusTab() {
  const {
    isLoading,
    dashStats,
    algStatus,
    smsGwHealth,
    vapiStatus,
    cronHealth,
    funnel,
    openIssues,
    alertCount,
    warningCount,

    totalCustomers,
    vipCustomers,
  } = useSettingsStatus();

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
      ) : (
        <div className="bg-emerald-500/[0.04] border border-emerald-500/25 p-6 flex items-center gap-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
          <div>
            <h3 className="font-semibold text-foreground tracking-tight">All clear.</h3>
            <p className="text-foreground/55 text-[12.5px] mt-0.5">
              No open alerts or warnings detected. Crons green · connections healthy · CTR thresholds clean.
            </p>
          </div>
        </div>
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
            online={smsGwHealth?.online ?? false}
            detail={smsGwHealth?.online ? `last seen ${smsGwHealth.ageMinutes ?? "?"}m ago` : "offline · check device"}
            onlineIcon={<MessageSquare className="w-3.5 h-3.5 text-emerald-400" />}
            offlineIcon={<MessageSquare className="w-3.5 h-3.5 text-red-400" />}
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

      {/* ── Cron health (wave-149) ──────────────────────────
          The blind spot that hid the never-scheduled cadence cron this
          session. Read-only last-24h cron_log feed — failed RED, skipped
          AMBER — so "what ran / what's failing" is one glance, not a log dive. */}
      <Panel
        title="Cron Health"
        subtitle="Last 24h — failed (red) + skipped (amber) surfaced"
        icon={<Activity className="w-4 h-4" />}
      >
        {(!cronHealth || cronHealth.length === 0) ? (
          <p className="text-foreground/40 text-[12px] p-2">No cron runs logged in the last 24h.</p>
        ) : (
          <div className="space-y-0.5 max-h-72 overflow-y-auto">
            {cronHealth.slice(0, 80).map((row: { jobName: string; status: string; durationMs: number | null; details: string | null; startedAt: string | Date | null }, i: number) => (
              <div
                key={`${row.jobName}-${i}`}
                className={`flex items-center gap-2 py-1 text-[11px] ${row.status === "failed" ? "text-red-400" : row.status === "skipped" ? "text-amber-400/70" : "text-foreground/50"}`}
              >
                <span className="w-40 truncate font-mono shrink-0">{row.jobName}</span>
                <span className="w-16 shrink-0">{row.status}</span>
                <span className="w-14 text-right shrink-0">{row.durationMs != null ? `${row.durationMs}ms` : "—"}</span>
                <span className="flex-1 truncate text-foreground/40">{row.details || ""}</span>
                <span className="text-foreground/25 shrink-0 hidden sm:inline">{row.startedAt ? new Date(row.startedAt).toLocaleTimeString() : ""}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* wave-181.x · Recent-events panel REMOVED for now.
          Placeholder roadmap text was leaking developer intent to the
          operator (CLAUDE.md red-flag: deferred TODOs displayed in
          production UI). Real activity feed lands when there's a
          unified events table to read from · see cron_alerts_fired +
          gateway events + git-tag pipeline (not yet wired). */}
    </div>
  );
}
