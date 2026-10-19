"use client";

/**
 * SystemHubGrid — the /system landing page's navigation surface.
 *
 * A grid of cards, one per subsurface, each with a live severity
 * chip showing current state. Cards are grouped by domain (Health,
 * Governance, AI, Data) so the list scans as short sections instead
 * of one undifferentiated wall. Only cards that resolve to a live,
 * distinct page are listed — see the CARDS prune note below.
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
  AlertCircle,
  AlertTriangle,
  Archive,
  Bot,
  Brain,
  Clock,
  DollarSign,
  FileText,
  Inbox,
  Stethoscope,
  Target,
} from "lucide-react";

type Severity = "healthy" | "warning" | "critical" | "info" | "unknown";
type CardGroup = "health" | "governance" | "ai" | "data";

/**
 * `measured` is optional ONLY for the deploy window (an old server payload
 * lacks it). The load-bearing check everywhere below is `=== false` — a
 * section the server explicitly marked unmeasured must never render as a
 * count, a "healthy", or a "no devices". Its zeros are shape filler from
 * a crashed scan or the open quota circuit, not observations.
 */
interface HubPayload {
  crons: {
    declared: number;
    silent: number;
    logRows48h: number;
    killed: number;
    measured?: boolean;
  };
  errors: { count24h: number; fatal24h: number; measured?: boolean };
  stale: { totalRows: number; categories: number; measured?: boolean };
  brain: {
    totalMemories: number;
    permanent: number;
    avgConfidence: number;
    measured?: boolean;
  };
  devices: { online: number; offline: number; total: number; measured?: boolean };
  pulse: { priorityCount: number; measured?: boolean };
  ai: { calls24h: number; costCents7d: number; measured?: boolean };
  generatedAt: string;
}

const UNMEASURED_CHIP = { label: "unmeasured", severity: "unknown" as Severity };
/** No payload: still loading, or the read failed (SystemHubGrid swaps in READ_FAILED_CHIP). */
const NOT_READ_CHIP = { label: "n/a", severity: "unknown" as Severity };
const READ_FAILED_CHIP = { label: "unknown", severity: "unknown" as Severity };

interface HubCard {
  href: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  group: CardGroup;
  description: string;
  chip: (d: HubPayload | null) => { label: string; severity: Severity };
  featured?: boolean; // edge-strong ring + floats to the top of its group
}

// Wave AD-honesty (2026-06-03): the prior "mega-delete" removed ~30
// /system subpages (eval/coverage/quality/devops/governance sprawl);
// next.config.ts now redirects those paths to the bare /system hub or
// to /system/calibration. Cards pointing at them landed the operator
// on the hub or a collision, not the titled surface. Pruned to the
// cards that map 1:1 to a live, distinct destination. Removed:
// cron-diagnostics, performance, chat-health (redirect/collide into
// crons/ai-cost/health), policies + power (→ bare hub), the whole
// deploy group (deployment-truth/repos/schema-history/migrations/
// coverage → hub/calibration), agent-traces/brain-bus/tools/skills
// (→ hub), the whole quality group (prompt/judge-eval/quality/
// ghost-nour/coverage → hub/calibration), Devices (→ hub). Stale Data
// is now a real in-page System section, so its live card is restored below.
// "Brain Categories" repointed /brain/categories (404) → /brain.
// Hardcoded "114 tools"/"1,423 skills" count chips went with their
// (now-dead) cards.
// Exported for tests/components/hub-grid-chips.test.ts — the chips are the
// decision layer, and pinning them through a render would need a trpc mock
// for what are already pure functions of the payload.
export const CARDS: HubCard[] = [
  {
    href: "/system/fleet",
    title: "Fleet Truth",
    icon: Stethoscope,
    group: "health",
    description:
      "Cross-app capability artifacts: statenour probes + nickstire health, produced not just invoked",
    // Static chip — this card links to the live view; claiming health
    // here without probing would be the exact lie the page exists to end.
    chip: () => ({ label: "both apps", severity: "unknown" }),
  },
  {
    href: "/system/health",
    title: "Diagnostics",
    icon: Stethoscope,
    group: "health",
    description:
      "Unified probe hub: env · crons · errors · backlog · vectors · pulse",
    featured: true,
    // Live chip merged in from the former "OS Health" card. "healthy" is a
    // claim about BOTH sources — if either scan did not run, the claim is
    // not available (2026-08-04: the quota circuit fed this chip fabricated
    // zeros and it printed "healthy" in green on a live page).
    // The old `fatal24h > 0` half was a dead branch (no writer ever emits
    // 'fatal'); degraded now keys on warning-level error volume instead.
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.errors.measured === false || d.crons.measured === false)
        return UNMEASURED_CHIP;
      const bad = d.errors.count24h > 20 || d.crons.silent > 2;
      return bad
        ? { label: "degraded", severity: "warning" }
        : { label: "healthy", severity: "healthy" };
    },
  },
  {
    href: "/system/crons",
    title: "Cron Deck",
    icon: Clock,
    group: "health",
    description: "Live cron control surface: enable/disable per job + run now",
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.crons.measured === false) return UNMEASURED_CHIP;
      if (d.crons.killed > 0)
        return { label: `${d.crons.killed} killed`, severity: "warning" };
      // A declared count is not a health verdict; silent jobs are the signal (09-F24).
      if (d.crons.silent > 0) return { label: `${d.crons.silent} silent`, severity: "warning" };
      return { label: `${d.crons.declared} jobs`, severity: "info" };
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
    // fatal24h counts level='error' (no writer ever emits 'fatal' — the old
    // >0-critical branch could never fire). Thresholds from the live
    // 2026-08-04 baseline (~12.6 errors/day): >=40/24h (~3x mean) critical,
    // >20/24h warning. Bare >0 would flag most ordinary days.
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.errors.measured === false) return UNMEASURED_CHIP;
      if (d.errors.fatal24h >= 40)
        return { label: `${d.errors.fatal24h} errors 24h`, severity: "critical" };
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
    description: "Cross-category alerts inspector · filter by category",
    chip: () => ({ label: "browse", severity: "info" }),
  },
  {
    href: "/system/actions",
    title: "Autonomous Actions",
    icon: Bot,
    group: "governance",
    description: "Nick's autonomous action audit: rules · approvals · history",
    chip: () => ({ label: "audit", severity: "info" }),
  },
  {
    href: "/system/ai-cost",
    title: "AI Cost",
    icon: DollarSign,
    group: "ai",
    description: "Per-model + per-feature burn rate with daily budget",
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      // A fabricated "$0.00 7d" reads as a spend observation; it is not.
      if (d.ai.measured === false) return UNMEASURED_CHIP;
      const usd = (d.ai.costCents7d / 100).toFixed(2);
      return { label: `$${usd} 7d`, severity: "info" };
    },
  },
  {
    // /brain/categories was deleted in the brain consolidation (no
    // redirect → 404). Bare /brain opens the Map tab, so this lands on
    // the Memory tab; /brain shows no people intelligence (audit 02-F18).
    href: "/brain?tab=memory",
    title: "Brain Categories",
    icon: Brain,
    group: "ai",
    description: "Memory tab: saved memories, recall, beliefs and contradictions",
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.brain.measured === false) return UNMEASURED_CHIP;
      return {
        label: `${d.brain.totalMemories.toLocaleString()} rows`,
        severity: "info",
      };
    },
  },
  {
    href: "/system#stale-data",
    title: "Stale Data",
    icon: Archive,
    group: "data",
    description: "Looks-live-but-old rows · exact category policy + targeted cleanup",
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.stale.measured === false) return UNMEASURED_CHIP;
      if (d.stale.totalRows === 0) return { label: "clean", severity: "healthy" };
      return {
        label: `${d.stale.totalRows} stale`,
        severity: d.stale.totalRows > 50 ? "critical" : "warning",
      };
    },
  },
  {
    href: "/system/logs",
    title: "Logs",
    icon: FileText,
    group: "data",
    description: "Recent request log + AI generation stream",
    chip: () => ({ label: "view", severity: "info" }),
  },
  {
    // v-truth · calibration is a LIVE page but the prune left it with no
    // hub card (the quality/eval cards that redirected here were removed).
    // Restore one honest, direct card so it stays reachable.
    href: "/system/calibration",
    title: "State Calibration",
    icon: Target,
    group: "ai",
    // Prediction accuracy (Brier) lives on /stats?tab=calibration; this page is the mood x kind grid (10-X3).
    description: "Suggestion hit rate by mood, LLM judge agreement",
    chip: () => ({ label: "eval", severity: "info" }),
  },
  {
    href: "/system/cockpit-observability",
    title: "Cockpit Observability",
    icon: Brain,
    group: "ai",
    description: "Live metrics, execution traces, memory decay, and prompt versions for Nick",
    // 2026-07-25 honest-health: was a hardcoded `() => "observing"/healthy`
    // that ignored the rollup — a fabricated status. Now shows the measured
    // 24h AI-call count as telemetry ("info"), never an unearned "healthy".
    chip: (d) => {
      if (!d) return NOT_READ_CHIP;
      if (d.ai.measured === false) return UNMEASURED_CHIP;
      return { label: `${d.ai.calls24h} calls · 24h`, severity: "info" };
    },
  },
  {
    // 2026-06-18 · IA reorg Phase 2 · surface the last orphaned system page.
    // /system/inbox (memory-quarantine review) was reachable from neither
    // nav nor cmdK nor a hub tile — only by typing the URL.
    href: "/system/inbox",
    title: "Memory Inbox",
    icon: Inbox,
    group: "ai",
    description: "Quarantined memory ingestion: review claims + contradictions before they land",
    chip: () => ({ label: "review", severity: "info" }),
  },
];

const SEVERITY_PALETTE: Record<
  Severity,
  { bg: string; border: string; dot: string; text: string }
> = {
  healthy: {
    bg: "bg-emerald-500/6",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
  },
  warning: {
    bg: "bg-amber-500/6",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
    text: "text-amber-300",
  },
  critical: {
    bg: "bg-rose-500/8",
    border: "border-rose-500/40",
    dot: "bg-rose-400",
    text: "text-rose-300",
  },
  info: {
    bg: "bg-sky-500/5",
    border: "border-sky-500/25",
    dot: "bg-sky-400",
    text: "text-sky-300",
  },
  unknown: {
    bg: "bg-surface-interactive",
    border: "border-edge-subtle",
    dot: "bg-fg-tertiary",
    text: "text-fg-tertiary",
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
  { id: "governance", label: "Governance" },
  { id: "ai", label: "AI & Brain" },
  { id: "data", label: "Data & Logs" },
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
          "font-mono text-[11px]",
          tone === "alert" ? "text-amber-300" : "text-(--text-tertiary)",
        )}
      >
        {label}
      </h3>
      <span className="text-[11px] tabular-nums text-fg-tertiary">
        {count}
      </span>
      <span className="h-px flex-1 bg-(--border-default)" />
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
        "group relative rounded-surface border p-3 transition-colors hover:bg-surface-hover",
        pal.bg,
        pal.border,
        card.featured && "ring-1 ring-edge-strong",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4 shrink-0",
              pal.text,
              "group-hover:text-(--text-primary)",
            )}
          />
          <span className="text-sm font-semibold text-(--text-primary)">
            {card.title}
          </span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
            pal.border,
            pal.text,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", pal.dot)} />
          {chip.label}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-(--text-secondary)">
        {card.description}
      </p>
    </Link>
  );
}

export function SystemHubGrid() {
  // Phase VV (2026-05-22) · REST→tRPC · system.hub. The legacy route
  // wrapped its rollup in `{ data }`; the procedure returns it
  // unwrapped. The page polled on a 60s setInterval — refetchInterval
  // now drives that. With no payload every live card returns NOT_READ_CHIP;
  // when the read FAILED that becomes the word "unknown" (2026-10-10 ·
  // audit 09-F7), so a failure never looks like a load in flight.
  const hubQuery = trpc.system.hub.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const data: HubPayload | null = hubQuery.data ?? null;

  const decorated = CARDS.map((c) => {
    const chip = c.chip(data);
    return { c, chip: chip === NOT_READ_CHIP && hubQuery.isError ? READ_FAILED_CHIP : chip };
  });

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
    ai: [],
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
