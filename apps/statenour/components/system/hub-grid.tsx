"use client";

/**
 * SystemHubGrid — the /system landing page's nav replacement.
 *
 * Before: a cramped row of pill-buttons, no liveness, 15+ chips
 * wrapping messily on mobile. You had to click to find out which
 * surface was broken.
 *
 * After: a grid of proper cards, one per subsurface, with a live
 * chip on each card showing the current state. Click the card to
 * deep-link.
 *
 * All data from ONE rollup endpoint (/api/system/hub) — avoids
 * 15 parallel fetches. Auto-refreshes every 60s. Cards whose
 * subsurface is currently DEGRADED bubble to the top via sort order.
 *
 * Power + Control pillars:
 *   - Each card owns a severity chip (healthy / warning / critical /
 *     unknown). You can see at a glance which surface needs eyes.
 *   - Description field explains WHAT the surface is for — no more
 *     hunting through pill labels to remember if "gaps" is tasks
 *     or brain.
 *   - Keyboard: cards are <Link> anchors, Tab-navigable.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { cn } from "@/lib/utils/cn";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Beaker,
  Bot,
  Brain,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  Database,
  DollarSign,
  Eye,
  FileText,
  GitBranch,
  Ghost,
  History,
  Scissors,
  MessageSquare,
  Radio,
  Server,
  Stethoscope,
  Timer,
  TrendingDown,
  TrendingUp,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

type Severity = "healthy" | "warning" | "critical" | "info" | "unknown";

interface HubPayload {
  crons: {
    declared: number;
    silent: number;
    logRows48h: number;
    killed: number;
  };
  errors: { count24h: number; fatal24h: number };
  stale: { totalRows: number; categories: number };
  brain: { totalMemories: number; permanent: number; avgConfidence: number };
  devices: { online: number; offline: number; total: number };
  pulse: { priorityCount: number };
  ai: { calls24h: number; costCents7d: number };
  power: { paused: boolean };
  generatedAt: string;
}

interface HubCard {
  href: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  chip: (d: HubPayload | null) => { label: string; severity: Severity };
  featured?: boolean; // highlighted border + subtle glow
}

const CARDS: HubCard[] = [
  {
    href: "/system/health",
    title: "Diagnostics",
    icon: Stethoscope,
    description: "Unified probe hub — env, crons, settings, browser, stale, pulse",
    featured: true,
    chip: () => ({ label: "run all", severity: "info" }),
  },
  {
    href: "/system/health",
    title: "OS Health",
    icon: Activity,
    description: "5-tile signal rollup: cron · errors · backlog · freshness · vectors",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      const bad = d.errors.fatal24h > 0 || d.crons.silent > 2;
      return bad
        ? { label: "degraded", severity: "warning" }
        : { label: "healthy", severity: "healthy" };
    },
  },
  {
    href: "/system/cron-diagnostics",
    title: "Cron Diagnostics",
    icon: Clock,
    description: "Per-job silent/slow detector with run-now + kill-switch",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.crons.silent > 0)
        return { label: `${d.crons.silent} silent`, severity: "warning" };
      return { label: `${d.crons.declared} firing`, severity: "healthy" };
    },
  },
  {
    href: "/system/crons",
    title: "Cron Deck",
    icon: Clock,
    description: "Live cron control surface — enable/disable per job + run now",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.crons.killed > 0)
        return { label: `${d.crons.killed} killed`, severity: "warning" };
      return { label: `${d.crons.declared} total`, severity: "healthy" };
    },
  },
  {
    // v10.0.306 · /system/errors absorbed into /system/logs as a
    // GROUPED view-mode tab. Fingerprint deck + per-row open-as-task
    // still here, just one fewer page route.
    href: "/system/logs?view=errors",
    title: "Errors",
    icon: AlertTriangle,
    description: "Fingerprinted error log with frequency + stack grouping",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.errors.fatal24h > 0)
        return { label: `${d.errors.fatal24h} fatal 24h`, severity: "critical" };
      if (d.errors.count24h > 20)
        return { label: `${d.errors.count24h} errs 24h`, severity: "warning" };
      return { label: `${d.errors.count24h} 24h`, severity: "healthy" };
    },
  },
  {
    href: "/system/alerts",
    title: "Alerts Inspector",
    icon: AlertCircle,
    description:
      "Cross-category alerts inspector · filter · drill into audit trail",
    chip: () => ({ label: "browse", severity: "info" }),
  },
  {
    href: "/system/coverage?view=embedding",
    title: "Embedding Coverage",
    icon: Database,
    description:
      "pgvector migration progress · dual-write coverage · dedup telemetry",
    chip: () => ({ label: "live", severity: "info" }),
  },
  {
    href: "/system",
    title: "Command Center",
    icon: Compass,
    description:
      "v9.0 Command Spine · single typed read of operating state · the same shape NICK consumes",
    chip: () => ({ label: "v9.0", severity: "info" }),
  },
  {
    // v10.0.307 · /system/prompt-comparison absorbed into /system/prompt
    // as a COMPARE view-mode tab.
    href: "/system/prompt?view=compare",
    title: "Prompt v1 vs v2",
    icon: Beaker,
    description:
      "v9.1 shadow comparison · side-by-side prompts · section coverage · size delta · flip NICK_PRIME_PROMPT once parity holds",
    chip: () => ({ label: "v9.1", severity: "info" }),
  },
  {
    href: "/system/deployment-truth",
    title: "Deployment Truth",
    icon: Server,
    description:
      "v10 single-pane fact sheet · build SHA · schema drift · env vars · cron 24h health · NICK Prime mode",
    featured: true,
    chip: () => ({ label: "v10", severity: "info" }),
  },
  {
    href: "/system/repos",
    title: "Repository Ecosystem",
    icon: GitBranch,
    description:
      "v10 cross-repo health · 8 repos × ring × tier · last commit + ecosystem briefing · NICK has no write access",
    chip: () => ({ label: "v10 E.1", severity: "info" }),
  },
  {
    href: "/system/schema-history",
    title: "Schema History",
    icon: History,
    description:
      "v10 migration audit · every db push · destructive flag + reason + rollback plan · planned/applied/failed",
    chip: () => ({ label: "v10 B.4", severity: "info" }),
  },
  {
    href: "/system/agent-traces",
    title: "Agent Traces",
    icon: Workflow,
    description:
      "v10 every AI call · root → child chain by traceId · provider · cost · outcome · 'Why did Nick do X?'",
    chip: () => ({ label: "v10 E.5", severity: "info" }),
  },
  {
    href: "/system/performance",
    title: "Slow Queries",
    icon: Database,
    description:
      "v10 Horizon 5 · top slow Prisma shapes · in-memory rolling buffer · per-lambda cold reset",
    chip: () => ({ label: "v10", severity: "info" }),
  },
  {
    href: "/system/brain-bus",
    title: "Brain-Bus Tail",
    icon: Radio,
    description:
      "v10 live durable event stream · cursor-based 3s poll · 24h status counts · pause/resume",
    chip: () => ({ label: "v10 B.2", severity: "info" }),
  },
  {
    href: "/system/coverage?view=schema",
    title: "Schema Coverage",
    icon: Database,
    description:
      "v10 Horizon 5 · row count × index count audit · cross-refs slow queries · flags under-indexed hot tables",
    chip: () => ({ label: "v10", severity: "info" }),
  },
  // v10.0.305 · /system/cron-runs index removed · /system/crons (live
  // control deck with sparklines + actions) covers the same data plus
  // toggle/run controls. Detail drill-down /cron-runs/[jobName] still
  // alive · /system/crons deep-links there. One fewer redundant entry.
  {
    href: "/system/logs",
    title: "Logs",
    icon: FileText,
    description: "Recent request log + AI generation stream",
    chip: () => ({ label: "view", severity: "info" }),
  },
  // v10.0.304 · /system/events removed · 3s real-time HUD UX was its
  // only unique value over /system/logs (which already covers the same
  // 4 sources + 1 more, just slower poll). Per elon: best part is no
  // part. Operators who want live can manually refresh /system/logs.
  {
    href: "/system/performance",
    title: "Performance",
    icon: Timer,
    description: "Per-route p50/p95/p99 latency + error rate",
    chip: () => ({ label: "p95", severity: "info" }),
  },
  {
    href: "/system/chat-health",
    title: "Chat Health",
    icon: MessageSquare,
    description: "TTFT · cost · error rate · regen rate · problem tools",
    chip: () => ({ label: "live", severity: "info" }),
  },
  {
    href: "/system/ai-cost",
    title: "AI Cost",
    icon: DollarSign,
    description: "Per-model + per-feature burn rate with daily budget",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      const usd = (d.ai.costCents7d / 100).toFixed(2);
      return { label: `$${usd} 7d`, severity: "info" };
    },
  },
  {
    href: "/system/tools",
    title: "Tool Inventory",
    icon: Beaker,
    description: "Nick's 114 tools grouped by family, filterable + searchable",
    chip: () => ({ label: "114 tools", severity: "info" }),
  },
  {
    href: "/system/skills",
    title: "Skill Registry",
    icon: Beaker,
    description: "1,423 Claude skills installed locally · search + filter by category, tag, source",
    chip: () => ({ label: "1,423 skills", severity: "info" }),
  },
  {
    href: "/system/actions",
    title: "Autonomous Actions",
    icon: Bot,
    description: "Nick's autonomous action audit — rules · approvals · history",
    chip: () => ({ label: "audit", severity: "info" }),
  },
  {
    href: "/system/policies",
    title: "Automation Policies",
    icon: Compass,
    description: "Governance spine — every cron/tool/slash with objective + approval class + rollback path",
    chip: () => ({ label: "registry", severity: "info" }),
    featured: true,
  },
  {
    href: "/system/approvals",
    title: "Approval Queue",
    icon: AlertCircle,
    description: "Pending autonomous actions awaiting operator review · approve / reject / drill into policy",
    chip: () => ({ label: "queue", severity: "info" }),
    featured: true,
  },
  {
    // v10.0.307 · /system/prompts absorbed into /system/prompt as a
    // LIBRARY view-mode tab.
    href: "/system/prompt?view=library",
    title: "Prompt Library",
    icon: FileText,
    description: "Reusable prompt templates · system prompts, role primers, verifiers, suggesters · all in one inspectable registry",
    chip: () => ({ label: "library", severity: "info" }),
  },
  {
    href: "/system/quality",
    title: "Nick Quality",
    icon: TrendingUp,
    description: "Critic scorecard — specificity, cliché, regeneration rate",
    chip: () => ({ label: "trend", severity: "info" }),
  },
  {
    href: "/system/quality?view=lessons",
    title: "Anti-patterns",
    icon: TrendingDown,
    description: "Failure library — 'I tried X, it failed, reason Y'",
    chip: () => ({ label: "library", severity: "info" }),
  },
  {
    href: "/system/quality?view=decisions",
    title: "Decision Drift",
    icon: Activity,
    description: "Rolling 3-week decision-grade delta",
    chip: () => ({ label: "weekly", severity: "info" }),
  },
  {
    href: "/system/ghost-nour",
    title: "Ghost Nour",
    icon: Ghost,
    description: "Accuracy scoreboard — what Nick predicted vs what happened",
    chip: () => ({ label: "predictions", severity: "info" }),
  },
  {
    href: "/system/coverage?view=gaps",
    title: "Gaps",
    icon: Eye,
    description: "Capability gaps — domains where Nick underperforms",
    chip: () => ({ label: "scan", severity: "info" }),
  },
  {
    href: "/system/coverage?view=stale",
    title: "Stale Data",
    icon: Scissors,
    description: "Purge surface — orphan convos, stale drift, abandoned tasks",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.stale.totalRows > 100)
        return {
          label: `${d.stale.totalRows} rows`,
          severity: "warning",
        };
      if (d.stale.totalRows > 0)
        return { label: `${d.stale.totalRows} rows`, severity: "info" };
      return { label: "clean", severity: "healthy" };
    },
  },
  {
    href: "/brain/categories",
    title: "Brain Categories",
    icon: Brain,
    description: "BrainMemory category heat-map + drift detector",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      return {
        label: `${d.brain.totalMemories.toLocaleString()} rows`,
        severity: "info",
      };
    },
  },
  {
    href: "/system/devices",
    title: "Devices",
    icon: Camera,
    description: "Camera fleet — Ring, Eufy, Tuya, v380",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.devices.offline > 0)
        return {
          label: `${d.devices.offline} offline`,
          severity: "warning",
        };
      return { label: `${d.devices.online}/${d.devices.total}`, severity: "healthy" };
    },
  },
  {
    href: "/system/power",
    title: "Power",
    icon: Zap,
    description: "Kill switches · provider caps · shadow mode · emergency stop",
    featured: true,
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.power.paused)
        return { label: "PAUSED", severity: "critical" };
      return { label: "live", severity: "healthy" };
    },
  },
];

const SEVERITY_PALETTE: Record<
  Severity,
  { bg: string; border: string; dot: string; text: string }
> = {
  healthy: {
    bg: "bg-emerald-500/[0.06]",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
  },
  warning: {
    bg: "bg-amber-500/[0.06]",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
    text: "text-amber-300",
  },
  critical: {
    bg: "bg-rose-500/[0.08]",
    border: "border-rose-500/40",
    dot: "bg-rose-400 animate-pulse",
    text: "text-rose-300",
  },
  info: {
    bg: "bg-sky-500/[0.05]",
    border: "border-sky-500/25",
    dot: "bg-sky-400",
    text: "text-sky-300",
  },
  unknown: {
    bg: "bg-white/[0.02]",
    border: "border-white/10",
    dot: "bg-zinc-500",
    text: "text-[var(--text-muted)]",
  },
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  healthy: 3,
  unknown: 4,
};

export function SystemHubGrid() {
  const [data, setData] = useState<HubPayload | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await authedFetch("/api/system/hub", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (alive && json?.data) setData(json.data);
      } catch {
        /* swallow — cards show "—" on failure */
      }
    }
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Sort: degraded first so problem surfaces bubble up without burying
  // the healthy majority. Featured cards hold their declared position
  // within each severity tier so Diagnostics + Power stay visible.
  const sorted = [...CARDS]
    .map((c) => ({ c, chip: c.chip(data) }))
    .sort((a, b) => {
      const sa = SEVERITY_ORDER[a.chip.severity];
      const sb = SEVERITY_ORDER[b.chip.severity];
      if (sa !== sb) return sa - sb;
      // Featured cards up within the same severity band.
      if (a.c.featured && !b.c.featured) return -1;
      if (!a.c.featured && b.c.featured) return 1;
      return 0;
    });

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map(({ c, chip }) => {
        const pal = SEVERITY_PALETTE[chip.severity];
        const Icon = c.icon;
        return (
          <Link
            key={c.href}
            href={c.href}
            className={cn(
              "group relative rounded-xl border p-3 transition-colors hover:bg-white/[0.04]",
              pal.bg,
              pal.border,
              c.featured && "ring-1 ring-[var(--gold)]/20",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    pal.text,
                    "group-hover:text-[var(--text-primary)]",
                  )}
                />
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {c.title}
                </span>
                {c.featured && (
                  <span className="text-[9px] uppercase tracking-wide text-[var(--gold)] opacity-80">
                    featured
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                  pal.border,
                  pal.text,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", pal.dot)} />
                {chip.label}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
              {c.description}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
