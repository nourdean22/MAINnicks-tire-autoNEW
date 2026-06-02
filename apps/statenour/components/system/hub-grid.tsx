"use client";

/**
 * SystemHubGrid — the /system landing page's navigation surface.
 *
 * A grid of cards, one per subsurface, each with a live severity
 * chip showing current state. Cards are grouped by domain (Health,
 * Governance, Deploy, AI, Quality, Data) so a 30+ card list scans
 * as six short sections instead of one undifferentiated wall.
 *
 * Any subsurface that is currently degraded (warning/critical) is
 * lifted into a "Needs attention" strip above the groups, so
 * problems hit your eye first without burying the healthy majority.
 *
 * All data from ONE rollup endpoint (/api/system/hub) — avoids 15
 * parallel fetches. Auto-refreshes every 60s. Cards are <Link>
 * anchors, Tab-navigable.
 *
 * Wave 52 (2026-05-20): de-duped three cards that each pointed at a
 * route a sibling card already owned — which was also a duplicate
 * <Link key={href}> React collision:
 *   · "OS Health"  → merged into "Diagnostics" (same /system/health
 *     route; Diagnostics adopted OS Health's live degraded chip).
 *   · "Slow Queries" → merged into "Performance" (same
 *     /system/performance route).
 *   · "Command Center" → removed (it self-linked to /system).
 * Added domain grouping + the attention strip.
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Beaker,
  Bot,
  Brain,
  Camera,
  Clock,
  Compass,
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
  Zap,
} from "lucide-react";

type Severity = "healthy" | "warning" | "critical" | "info" | "unknown";
type CardGroup = "health" | "governance" | "deploy" | "ai" | "quality" | "data";

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
  group: CardGroup;
  description: string;
  chip: (d: HubPayload | null) => { label: string; severity: Severity };
  featured?: boolean; // gold ring + floats to the top of its group
}

const CARDS: HubCard[] = [
  {
    href: "/system/health",
    title: "Diagnostics",
    icon: Stethoscope,
    group: "health",
    description:
      "Unified probe hub — env · crons · errors · backlog · vectors · pulse",
    featured: true,
    // Live chip merged in from the former "OS Health" card.
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
    group: "health",
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
    group: "health",
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
    group: "health",
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
    group: "health",
    description:
      "Cross-category alerts inspector · filter · drill into audit trail",
    chip: () => ({ label: "browse", severity: "info" }),
  },
  {
    // Wave AW · 2026-05-28 · discoverability for the Wave AU viewer.
    // Without this tile the operator would need to type the URL — the
    // 9-writer Coach Channel had a write side + 5 read banners but the
    // historical viewer was orphaned. Mirrors the Alerts Inspector
    // shape · same group · sibling observability surface.
    href: "/system/coach-events",
    title: "Coach Channel",
    icon: Radio,
    group: "health",
    description:
      "Historical viewer · 9 detectors → 5 surfaces · filter + audit acked",
    chip: () => ({ label: "browse", severity: "info" }),
  },
  {
    href: "/system/performance",
    title: "Performance",
    icon: Timer,
    group: "health",
    // Wave 52 · the former "Slow Queries" card pointed at this same
    // route — its slow-Prisma-shape view folded into the description.
    description:
      "Per-route p50/p95/p99 latency + error rate · slow Prisma query shapes",
    chip: () => ({ label: "p95", severity: "info" }),
  },
  {
    href: "/system/chat-health",
    title: "Chat Health",
    icon: MessageSquare,
    group: "health",
    description: "TTFT · cost · error rate · regen rate · problem tools",
    chip: () => ({ label: "live", severity: "info" }),
  },
  {
    href: "/system/actions",
    title: "Autonomous Actions",
    icon: Bot,
    group: "governance",
    description: "Nick's autonomous action audit — rules · approvals · history",
    chip: () => ({ label: "audit", severity: "info" }),
  },
  {
    href: "/system/policies",
    title: "Automation Policies",
    icon: Compass,
    group: "governance",
    description:
      "Governance spine — every cron/tool/slash with objective + approval class + rollback path",
    chip: () => ({ label: "registry", severity: "info" }),
    featured: true,
  },
  {
    href: "/system/approvals",
    title: "Approval Queue",
    icon: AlertCircle,
    group: "governance",
    description:
      "Pending autonomous actions awaiting operator review · approve / reject / drill into policy",
    chip: () => ({ label: "queue", severity: "info" }),
    featured: true,
  },
  {
    href: "/system/power",
    title: "Power",
    icon: Zap,
    group: "governance",
    description: "Kill switches · provider caps · shadow mode · emergency stop",
    featured: true,
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.power.paused) return { label: "PAUSED", severity: "critical" };
      return { label: "live", severity: "healthy" };
    },
  },
  {
    href: "/system/deployment-truth",
    title: "Deployment Truth",
    icon: Server,
    group: "deploy",
    description:
      "v10 single-pane fact sheet · build SHA · schema drift · env vars · cron 24h health · NICK Prime mode",
    featured: true,
    chip: () => ({ label: "v10", severity: "info" }),
  },
  {
    href: "/system/repos",
    title: "Repository Ecosystem",
    icon: GitBranch,
    group: "deploy",
    description:
      "v10 cross-repo health · 8 repos × ring × tier · last commit + ecosystem briefing · NICK has no write access",
    chip: () => ({ label: "v10 E.1", severity: "info" }),
  },
  {
    href: "/system/schema-history",
    title: "Schema History",
    icon: History,
    group: "deploy",
    description:
      "v10 migration audit · every db push · destructive flag + reason + rollback plan · planned/applied/failed",
    chip: () => ({ label: "v10 B.4", severity: "info" }),
  },
  {
    // Phase Q.3 · 2026-05-18 PM · live tracker for in-flight
    // migrations (tRPC, persona-wiring) + feature flags
    // board. Replaces "trust commit messages + MEMORY notes".
    href: "/system/migrations",
    title: "Migrations",
    icon: GitBranch,
    group: "deploy",
    description:
      "Live tracker · strangler-fig progress · % surfaces migrated · feature flag board · Q.3",
    chip: () => ({ label: "tracker", severity: "info" }),
  },
  {
    href: "/system/coverage?view=schema",
    title: "Schema Coverage",
    icon: Database,
    group: "deploy",
    description:
      "v10 Horizon 5 · row count × index count audit · cross-refs slow queries · flags under-indexed hot tables",
    chip: () => ({ label: "v10", severity: "info" }),
  },
  {
    href: "/system/coverage?view=embedding",
    title: "Embedding Coverage",
    icon: Database,
    group: "ai",
    description:
      "pgvector migration progress · dual-write coverage · dedup telemetry",
    chip: () => ({ label: "live", severity: "info" }),
  },
  {
    href: "/system/agent-traces",
    title: "Agent Traces",
    icon: Workflow,
    group: "ai",
    description:
      "v10 every AI call · root → child chain by traceId · provider · cost · outcome · 'Why did Nick do X?'",
    chip: () => ({ label: "v10 E.5", severity: "info" }),
  },
  {
    href: "/system/brain-bus",
    title: "Brain-Bus Tail",
    icon: Radio,
    group: "ai",
    description:
      "v10 live durable event stream · cursor-based 3s poll · 24h status counts · pause/resume",
    chip: () => ({ label: "v10 B.2", severity: "info" }),
  },
  {
    href: "/system/ai-cost",
    title: "AI Cost",
    icon: DollarSign,
    group: "ai",
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
    group: "ai",
    description: "Nick's 114 tools grouped by family, filterable + searchable",
    chip: () => ({ label: "114 tools", severity: "info" }),
  },
  {
    href: "/system/skills",
    title: "Skill Registry",
    icon: Beaker,
    group: "ai",
    description:
      "1,423 Claude skills installed locally · search + filter by category, tag, source",
    chip: () => ({ label: "1,423 skills", severity: "info" }),
  },
  {
    href: "/brain/categories",
    title: "Brain Categories",
    icon: Brain,
    group: "ai",
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
    // v10.0.307 · /system/prompt-comparison absorbed into /system/prompt
    // as a COMPARE view-mode tab.
    href: "/system/prompt?view=compare",
    title: "Prompt v1 vs v2",
    icon: Beaker,
    group: "quality",
    description:
      "v9.1 shadow comparison · side-by-side prompts · section coverage · size delta · flip NICK_PRIME_PROMPT once parity holds",
    chip: () => ({ label: "v9.1", severity: "info" }),
  },
  {
    // Phase V · 2026-05-18 PM · judge-eval dashboard · LLM-as-judge
    // comparator · per-intent breakdown · prompt A/B regression
    // verdict (safe / watch / regressing).
    href: "/system/judge-eval",
    title: "Judge-eval V1↔V2",
    icon: Beaker,
    group: "quality",
    description:
      "LLM-as-judge comparator · win rate per intent · prompt A/B regression guard",
    chip: () => ({ label: "verdict", severity: "info" }),
  },
  {
    // v10.0.307 · /system/prompts absorbed into /system/prompt as a
    // LIBRARY view-mode tab.
    href: "/system/prompt?view=library",
    title: "Prompt Library",
    icon: FileText,
    group: "quality",
    description:
      "Reusable prompt templates · system prompts, role primers, verifiers, suggesters · all in one inspectable registry",
    chip: () => ({ label: "library", severity: "info" }),
  },
  {
    href: "/system/quality",
    title: "Nick Quality",
    icon: TrendingUp,
    group: "quality",
    description: "Critic scorecard — specificity, cliché, regeneration rate",
    chip: () => ({ label: "trend", severity: "info" }),
  },
  {
    href: "/system/quality?view=lessons",
    title: "Anti-patterns",
    icon: TrendingDown,
    group: "quality",
    description: "Failure library — 'I tried X, it failed, reason Y'",
    chip: () => ({ label: "library", severity: "info" }),
  },
  {
    href: "/system/quality?view=decisions",
    title: "Decision Drift",
    icon: Activity,
    group: "quality",
    description: "Rolling 3-week decision-grade delta",
    chip: () => ({ label: "weekly", severity: "info" }),
  },
  {
    href: "/system/ghost-nour",
    title: "Ghost Nour",
    icon: Ghost,
    group: "quality",
    description: "Accuracy scoreboard — what Nick predicted vs what happened",
    chip: () => ({ label: "predictions", severity: "info" }),
  },
  {
    href: "/system/coverage?view=gaps",
    title: "Gaps",
    icon: Eye,
    group: "quality",
    description: "Capability gaps — domains where Nick underperforms",
    chip: () => ({ label: "scan", severity: "info" }),
  },
  // v10.0.305 · /system/cron-runs index removed · /system/crons (live
  // control deck with sparklines + actions) covers the same data plus
  // toggle/run controls. Detail drill-down /cron-runs/[jobName] still
  // alive · /system/crons deep-links there. One fewer redundant entry.
  {
    href: "/system/logs",
    title: "Logs",
    icon: FileText,
    group: "data",
    description: "Recent request log + AI generation stream",
    chip: () => ({ label: "view", severity: "info" }),
  },
  {
    href: "/system/coverage?view=stale",
    title: "Stale Data",
    icon: Scissors,
    group: "data",
    description: "Purge surface — orphan convos, stale drift, abandoned tasks",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.stale.totalRows > 100)
        return { label: `${d.stale.totalRows} rows`, severity: "warning" };
      if (d.stale.totalRows > 0)
        return { label: `${d.stale.totalRows} rows`, severity: "info" };
      return { label: "clean", severity: "healthy" };
    },
  },
  {
    href: "/system/devices",
    title: "Devices",
    icon: Camera,
    group: "data",
    description: "Camera fleet — Ring, Eufy, Tuya, v380",
    chip: (d) => {
      if (!d) return { label: "—", severity: "unknown" };
      if (d.devices.offline > 0)
        return { label: `${d.devices.offline} offline`, severity: "warning" };
      return {
        label: `${d.devices.online}/${d.devices.total}`,
        severity: "healthy",
      };
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

// Display order of the domain groups. The attention strip always
// renders above these regardless of order.
const GROUP_ORDER: { id: CardGroup; label: string }[] = [
  { id: "health", label: "Health & Jobs" },
  { id: "governance", label: "Governance & Power" },
  { id: "deploy", label: "Deploy & Schema" },
  { id: "ai", label: "AI & Brain" },
  { id: "quality", label: "Prompts & Quality" },
  { id: "data", label: "Data & Devices" },
];

function GroupHeader({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone?: "alert";
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.14em]",
          tone === "alert" ? "text-amber-300" : "text-[var(--text-tertiary)]",
        )}
      >
        {label}
      </h3>
      <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
        {count}
      </span>
      <span className="h-px flex-1 bg-[var(--border-default)]" />
    </div>
  );
}

function HubCardLink({
  card,
  chip,
}: {
  card: HubCard;
  chip: { label: string; severity: Severity };
}) {
  const pal = SEVERITY_PALETTE[chip.severity];
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      className={cn(
        "group relative rounded-xl border p-3 transition-colors hover:bg-white/[0.04]",
        pal.bg,
        pal.border,
        card.featured && "ring-1 ring-[var(--gold)]/20",
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
            {card.title}
          </span>
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
        {card.description}
      </p>
    </Link>
  );
}

export function SystemHubGrid() {
  // Phase VV (2026-05-22) · REST→tRPC · system.hub. The legacy route
  // wrapped its rollup in `{ data }`; the procedure returns it
  // unwrapped. The page polled on a 60s setInterval — refetchInterval
  // now drives that. A failed fetch leaves `data` null and every card
  // falls back to its "—" chip, exactly as the prior swallowed catch.
  const hubQuery = trpc.system.hub.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const data: HubPayload | null = hubQuery.data ?? null;

  const decorated = CARDS.map((c) => ({ c, chip: c.chip(data) }));

  // Degraded surfaces (warning/critical) lift into a "Needs attention"
  // strip above the groups — problems hit the eye first. Critical
  // sorts before warning within the strip.
  const attention = decorated
    .filter(
      (x) => x.chip.severity === "critical" || x.chip.severity === "warning",
    )
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.chip.severity] - SEVERITY_ORDER[b.chip.severity],
    );
  const attentionHrefs = new Set(attention.map((x) => x.c.href));

  // Remaining (healthy / info / unknown) cards bucket into their
  // domain group. Featured cards float to the top of each group;
  // the rest hold declared order (Array.prototype.sort is stable).
  const grouped: Record<CardGroup, typeof decorated> = {
    health: [],
    governance: [],
    deploy: [],
    ai: [],
    quality: [],
    data: [],
  };
  for (const x of decorated) {
    if (attentionHrefs.has(x.c.href)) continue;
    grouped[x.c.group].push(x);
  }
  for (const list of Object.values(grouped)) {
    list.sort((a, b) =>
      a.c.featured === b.c.featured ? 0 : a.c.featured ? -1 : 1,
    );
  }

  return (
    <div className="space-y-5">
      {attention.length > 0 && (
        <section>
          <GroupHeader
            label="Needs attention"
            count={attention.length}
            tone="alert"
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {attention.map(({ c, chip }) => (
              <HubCardLink key={c.href} card={c} chip={chip} />
            ))}
          </div>
        </section>
      )}

      {GROUP_ORDER.map(({ id, label }) => {
        const members = grouped[id];
        if (members.length === 0) return null;
        return (
          <section key={id}>
            <GroupHeader label={label} count={members.length} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map(({ c, chip }) => (
                <HubCardLink key={c.href} card={c} chip={chip} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
