"use client";

/**
 * SettingsConsole — durable operator configuration, nothing else.
 *
 * Ownership test (full-circle wave 2, 2026-10-02 · docs/design/settings-census-2026-10-02.md):
 * a block belongs here when it writes a preference the runtime READS back
 * (identity pins, journal weights, people scoring, AI config, feature flags,
 * operating rhythm, push subscription, the ticker's dismissed set). Machine
 * operations — health, errors, crons, deploys, hub navigation — belong to
 * /system and its subpages, where the same data already had a home:
 *
 *   SystemOpsHub        -> duplicate of /system's SystemHubGrid (deleted)
 *   HQErrorsCard        -> /system control tower + /system/logs?view=errors (deleted)
 *   SystemInfoCard      -> /system hub chips carry tools + brain status (deleted)
 *   CommandSpinePulse   -> linked to /system from a page about to be /system (deleted)
 *   SystemHealthCard    -> /system/health (moved)
 *   SystemDataCards     -> /system/health (health trend · error rate · quotas) + /brain (memory of the day)
 *   DeployChip          -> /system header (moved)
 *   CronControlPanel    -> /system/crons already owns the kill switch + run-now (deleted; runbook links ported)
 *   SkillLibraryPanel   -> /brain self-model already mounts it (second mount removed)
 *
 * Three domains remain. The a11y contract (useId + role=region + labelled
 * heading, decorative icon hidden) is pinned by tests/components/mobile-a11y.test.tsx.
 */

import { useState, useId } from "react";
import { cn } from "@/lib/utils";
import { User, Cpu, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { AiSettingsPanel } from "@/components/settings/ai-settings-panel";
import { IntelligenceFlagsPanel } from "@/components/settings/intelligence-flags-panel";
import { PeopleScoringPanel } from "@/components/settings/people-scoring-panel";
import { JournalBrainPanel } from "@/components/settings/journal-brain-panel";
import { IdentityPanel } from "@/components/settings/identity-panel";
import { OperatingRhythmToggle } from "@/components/settings/operating-rhythm-toggle";
import { PushNotificationToggle } from "@/components/settings/push-notification-toggle";
import { TickerDismissalReset } from "@/components/settings/ticker-dismissal-card";

type DomainId = "identity" | "cognitive" | "automation";

interface DomainConfig {
  id: DomainId;
  label: string;
  icon: LucideIcon;
  description: string;
}

const DOMAINS: DomainConfig[] = [
  {
    id: "identity",
    label: "Identity & Behavior",
    icon: User,
    description: "Who you are, how you score the world, and behavioral baselines.",
  },
  {
    id: "cognitive",
    label: "Cognitive Engine",
    icon: Cpu,
    description: "AI reasoning depth, tool access, feature flags, and the agent's operating rhythm.",
  },
  {
    id: "automation",
    label: "Notifications",
    icon: Zap,
    description: "Push notifications and the ticker's dismissed-items cache. Crons live on /system/crons.",
  },
];

/** Where the operations this page used to host now live, plus the habits pointer it always had. One link each, no live data. */
const ELSEWHERE_LINKS: { href: string; label: string }[] = [
  { href: "/system", label: "System · health, errors, deploys" },
  { href: "/system/crons", label: "Crons · kill switch, run now, runbooks" },
  { href: "/brain", label: "Brain · skill library, memory of the day" },
  { href: "/missions", label: "Manage Habits" },
];

export function SettingsConsole() {
  const [activeDomain, setActiveDomain] = useState<DomainId>("identity");
  const headingId = useId();

  const activeConfig = DOMAINS.find((d) => d.id === activeDomain);

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start w-full relative">
      {/* LEFT PANE: Navigation Matrix */}
      <aside className="w-full lg:w-64 shrink-0 flex flex-col gap-2 lg:sticky lg:top-6">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-fg-tertiary px-2 pb-2">
          Domains
        </h2>
        {/* Mobile: one compact wrapping row (the old stacked list spent a full
            viewport on navigation before any control appeared). Desktop keeps
            the sidebar. */}
        <nav className="flex flex-row flex-wrap gap-1 lg:flex-col">
          {DOMAINS.map((domain) => {
            const isActive = activeDomain === domain.id;
            const Icon = domain.icon;
            return (
              <button
                key={domain.id}
                onClick={() => setActiveDomain(domain.id)}
                aria-pressed={isActive}
                className={cn(
                  "flex min-h-[44px] items-center gap-2 lg:gap-3 px-3 py-2 lg:py-2.5 rounded-control text-[13px] lg:text-sm text-left transition-colors duration-[var(--motion-state)]",
                  isActive
                    ? "bg-accent-soft text-fg font-medium border border-transparent"
                    : "text-fg-secondary hover:bg-surface-hover hover:text-fg border border-transparent"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-fg" : "text-fg-tertiary")} />
                {domain.label}
              </button>
            );
          })}
        </nav>

        {/* Operations moved out of Settings (wave 2): pointers only. */}
        <div className="mt-3 lg:mt-8 px-2">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-fg-tertiary mb-2">
            Elsewhere
          </p>
          <ul className="flex flex-col">
            {ELSEWHERE_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex min-h-[44px] items-center gap-2 text-xs text-fg-secondary hover:text-fg transition-colors duration-[var(--motion-state)] py-1 lg:min-h-0"
                >
                  {l.label} ↗
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* RIGHT PANE: Configuration */}
      <div
        className="flex-1 w-full flex flex-col gap-6 lg:border-l lg:border-[var(--border-default)] lg:pl-8 lg:min-h-[600px]"
        role="region"
        aria-labelledby={headingId}
      >
        {/* Domain Header */}
        {activeConfig && (
          <div className="mb-2 pb-6 border-b border-[var(--border-default)]">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-control bg-surface-raised text-fg-tertiary" aria-hidden="true">
                <activeConfig.icon className="w-5 h-5" />
              </div>
              <h1 id={headingId} className="text-xl font-semibold text-fg">
                {activeConfig.label}
              </h1>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              {activeConfig.description}
            </p>
          </div>
        )}

        {/* Dynamic Content */}
        <div className="flex flex-col gap-6 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {activeDomain === "identity" && (
            <>
              <IdentityPanel />
              <JournalBrainPanel />
              <PeopleScoringPanel />
            </>
          )}

          {activeDomain === "cognitive" && (
            <>
              <AiSettingsPanel />
              <IntelligenceFlagsPanel />
              <OperatingRhythmToggle />
            </>
          )}

          {activeDomain === "automation" && (
            <>
              <PushNotificationToggle />
              <TickerDismissalReset />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
