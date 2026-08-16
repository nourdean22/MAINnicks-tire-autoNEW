"use client";

/**
 * components/settings/system-ops-hub.tsx · 2026-05-24 · Wave Q.
 *
 * Extracted from app/(mastery)/settings/page.tsx · pre-extraction the
 * SystemOpsHub was ~230 lines inline at the bottom of the 935-line
 * settings page · the extraction follows the existing
 * components/settings/* pattern (ai-settings-panel · cron-control-panel
 * · skill-library-panel · identity-panel · system-data-cards).
 *
 * Why the move: file-size hygiene (page.tsx now stays ~540 LOC instead
 * of 935) + makes the system-ops nav structure independently editable
 * from the settings page composition.
 *
 * No visual or behavior change · this is a pure relocation. The hub
 * still:
 *   · groups the live /system/* surfaces into 4 named categories
 *   · pulls live counts from useSystemPulse (errors24h · cronFails24h
 *     · actionsPending · etc) and renders them as colored badges
 *   · auto-tints counts (rose for failing · amber for warn · emerald
 *     for healthy · zinc for zero)
 *   · md:grid-cols-2 on desktop · single-column on mobile
 */

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  Clock,
  FileText,
  Gauge,
  Zap,
} from "lucide-react";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";
import type { useSystemPulse } from "@/lib/hooks/use-system-pulse";

type SystemPulseShape = ReturnType<typeof useSystemPulse>;

/**
 * What the header timestamp may claim. When the Neon quota circuit is open,
 * `buildSystemPulse` short-circuits with fabricated zeros AND a genuinely
 * fresh generatedAt on the same object — so "live · last refresh HH:MM:SS"
 * beside all-zero badges was a confident freshness claim about counts that
 * were never read. Same class as the home strip's "calm" (#1346); this is
 * the second consumer of dbQuotaExhausted. PURE and exported for the pin.
 */
export function opsHubFreshness(
  pulse: { generatedAt?: string; dbQuotaExhausted?: boolean } | null | undefined,
): "loading" | "degraded" | "live" {
  if (!pulse?.generatedAt) return "loading";
  if (pulse.dbQuotaExhausted === true) return "degraded";
  return "live";
}

export function SystemOpsHub({ pulse }: { pulse: SystemPulseShape }) {
  const freshness = opsHubFreshness(pulse);
  const groups: Array<{
    heading: string;
    tint: string;
    items: Array<{
      href: string;
      icon: React.ComponentType<{ size?: number; className?: string }>;
      label: string;
      subtitle: string;
      count?: number;
      countTint?: string;
      soon?: boolean;
    }>;
  }> = [
    {
      heading: "Health",
      tint: "text-emerald-300",
      items: [
        { href: "/system", icon: Activity, label: "Overview", subtitle: "diagnostics · DB · integrations · models" },
        { href: "/system/health", icon: Gauge, label: "Health probe", subtitle: "DB latency · device count · uptime" },
        { href: "/system/logs", icon: FileText, label: "Live logs", subtitle: "unified tail · errors + crons + metrics + actions + requests" },
        {
          // v10.0.306 · /system/errors absorbed into /system/logs
          // grouped view-mode tab
          href: "/system/logs?view=errors",
          icon: AlertTriangle,
          label: "Errors",
          subtitle: "fingerprints grouped · stack traces · → task",
          count: pulse?.errors24h ?? 0,
          countTint: (pulse?.errors24h ?? 0) > 0 ? "text-rose-300 bg-rose-500/15" : "text-zinc-500 bg-zinc-800",
        },
      ],
    },
    {
      heading: "Crons + automation",
      tint: "text-violet-300",
      items: [
        {
          href: "/system/crons",
          icon: Clock,
          label: "Crons",
          subtitle: "kill · run-now · sparklines · drift detector",
          count: (pulse?.cronsDrifted ?? 0) + (pulse?.cronFails24h ?? 0),
          countTint: ((pulse?.cronsDrifted ?? 0) + (pulse?.cronFails24h ?? 0)) > 0 ? "text-rose-300 bg-rose-500/15 animate-pulse" : "text-zinc-500 bg-zinc-800",
        },
        {
          href: "/system/actions",
          icon: Bot,
          label: "Nick actions",
          subtitle: "autonomous action audit · rule leaderboard · rollback",
          count: pulse?.actionsPending ?? 0,
          countTint: (pulse?.actionsPending ?? 0) > 0 ? "text-amber-300 bg-amber-500/15" : "text-zinc-500 bg-zinc-800",
        },
      ],
    },
    {
      heading: "Nick · AI",
      tint: "text-sky-300",
      items: [
        {
          href: "/system/ai-cost",
          icon: Zap,
          label: "AI cost",
          subtitle: "today/7d/30d · by feature × model · burn rate",
          count: pulse?.aiCalls24h ?? 0,
          countTint: "text-sky-300 bg-sky-500/10",
        },
        {
          // Wave AD · /system/{quality,decision-drift,ghost-nour,
          // anti-patterns,gaps} all deleted → redirect to /system/
          // calibration (next.config.ts). One honest link to the
          // surviving surface instead of five 404-bound nav rows.
          href: "/system/calibration",
          icon: Gauge,
          label: "Calibration",
          subtitle: "eval scores · decision grades · operator-state lens",
        },
        { href: "/chat", icon: Brain, label: "Nick chat", subtitle: "talk to Nick · tool calls · citations" },
      ],
    },
    {
      heading: "Brain + memory",
      tint: "text-amber-300",
      items: [
        {
          href: "/brain",
          icon: Brain,
          label: "Brain",
          subtitle: "memories · patterns · automation rules · graph explorer",
        },
        {
          href: "/journal",
          icon: FileText,
          label: "Journal",
          subtitle: "raw thoughts · brain dumps · reflections · daily logs",
        },
      ],
    },
  ];

  return (
    <GlassCard>
      <div className="mb-3 flex items-center justify-between">
        <p className="section-label">System ops</p>
        <span
          className={cn(
            "text-[10px]",
            freshness === "degraded" ? "text-amber-300/80" : "text-[var(--text-tertiary)]",
          )}
        >
          {freshness === "degraded"
            ? "db quota circuit open · counts unmeasured"
            : pulse?.generatedAt
              ? `live · last refresh ${new Date(pulse.generatedAt).toLocaleTimeString()}`
              : "loading pulse…"}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.heading} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-void)]/40 p-3">
            <h3 className={cn("mb-2 text-[10px] font-semibold uppercase tracking-wider", g.tint)}>
              {g.heading}
            </h3>
            <div className="space-y-1">
              {g.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded px-2 py-2 transition",
                      "hover:bg-[var(--bg-raised)]"
                    )}
                  >
                    <Icon size={14} className="text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-[var(--text-primary)] group-hover:text-[var(--gold)]">
                        {item.label}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">
                        {item.subtitle}
                      </div>
                    </div>
                    {item.count !== undefined && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-[1px] text-[9px] font-mono tabular-nums",
                          item.countTint ?? "text-zinc-500 bg-zinc-800",
                        )}
                      >
                        <AnimatedCounter value={item.count} duration={600} />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
